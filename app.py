import os
import json
import uuid
import paramiko
import uvicorn
import asyncio
import socket
import logging
from contextlib import asynccontextmanager
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from aiocache import Cache
from datetime import datetime
from enum import Enum

# --- CONFIGURATION ---
FTP_HOST = os.environ.get("FTP_HOST")
FTP_USER = os.environ.get("FTP_USER")
FTP_PASS = os.environ.get("FTP_PASS")
FTP_PORT = int(os.environ.get("FTP_PORT", 22))
BASE_DIR = os.environ.get("FTP_DIR", "storage.1ink.us")

# --- STORAGE MAP ---
STORAGE_MAP = {
    "song":     {"folder": "songs",    "index": "_songs.json"},
    "pattern":  {"folder": "patterns", "index": "_patterns.json"},
    "bank":     {"folder": "banks",    "index": "_banks.json"},
    "sample":   {"folder": "samples",  "index": "_samples.json"},
    "default":  {"folder": "misc",     "index": "_misc.json"}
}

# --- THREAD POOL ---
# Limits concurrent SFTP operations to prevent server overload
io_executor = ThreadPoolExecutor(max_workers=10)

async def run_sftp(func, *args, **kwargs):
    """Runs a blocking SFTP operation in the thread pool"""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(io_executor, lambda: func(*args, **kwargs))

# --- CACHE ---
# Caches library lists for 30 seconds to reduce SFTP hits
cache = Cache(Cache.MEMORY)

# --- CONCURRENCY LOCK ---
INDEX_LOCK = None

# --- CONNECTION POOL ---
class SFTPPool:
    def __init__(self, min_size=1, max_size=5):
        self.pool = asyncio.Queue(maxsize=max_size)
        self.max_size = max_size
        self.current_size = 0
        self.lock = asyncio.Lock()

    async def initialize(self):
        """Create initial connections"""
        for _ in range(self.pool.maxsize): # Pre-fill partially or fully
             if self.current_size < self.max_size:
                conn = await self._create_connection()
                if conn:
                    await self.pool.put(conn)

    async def _create_connection(self):
        try:
            def _connect():
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(10)
                sock.connect((FTP_HOST, FTP_PORT))

                t = paramiko.Transport(sock)
                # Optimization: Increase window/packet sizes
                t.default_window_size = 32 * 1024 * 1024
                t.default_max_packet_size = 128 * 1024

                t.connect(username=FTP_USER, password=FTP_PASS)
                t.set_keepalive(15)

                sftp = paramiko.SFTPClient.from_transport(t)

                # Ensure Base Dir
                try:
                    sftp.chdir(BASE_DIR)
                except IOError:
                    try:
                        sftp.mkdir(BASE_DIR)
                        sftp.chdir(BASE_DIR)
                    except: pass

                return sftp, t

            sftp, t = await run_sftp(_connect)
            async with self.lock:
                self.current_size += 1
            print("🔌 Pool: Created new connection")
            return sftp, t
        except Exception as e:
            print(f"❌ Pool: Connection failed: {e}")
            return None

    async def acquire(self):
        """Get a healthy connection"""
        sftp, transport = await self.pool.get()

        # Simple health check
        if transport.is_active():
            return sftp, transport
        else:
            print("⚠️ Pool: Discarding dead connection")
            async with self.lock:
                self.current_size -= 1
            # Close old
            await run_sftp(transport.close)
            # Create new replacement
            return await self._create_connection()

    async def release(self, sftp, transport):
        """Return to pool"""
        if transport.is_active():
            try:
                self.pool.put_nowait((sftp, transport))
            except asyncio.QueueFull:
                # Should not happen if logic is correct, but safe cleanup
                await run_sftp(transport.close)
        else:
            async with self.lock:
                self.current_size -= 1

    async def close_all(self):
        while not self.pool.empty():
            sftp, t = await self.pool.get()
            await run_sftp(t.close)

sftp_pool = SFTPPool(min_size=1, max_size=5)

# --- LIFESPAN ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global INDEX_LOCK
    INDEX_LOCK = asyncio.Lock()
    await sftp_pool.initialize()
    print("--- SERVER STARTUP: SFTP Pool & Lock Ready ---")
    yield
    await sftp_pool.close_all()
    io_executor.shutdown()

app = FastAPI(lifespan=lifespan)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELS ---
class ItemPayload(BaseModel):
    name: str
    author: str
    description: Optional[str] = ""
    type: str = "song"
    data: dict
    tags: Optional[List[str]] = None
    folder: Optional[str] = "default"

class MetaData(BaseModel):
    id: str
    name: str
    author: str
    date: str
    type: str
    description: Optional[str] = ""
    filename: str
    size: Optional[int] = None
    url: Optional[str] = None
    version: Optional[int] = 1
    tags: Optional[List[str]] = None
    folder: Optional[str] = "default"

# --- RESPONSE WRAPPER (matches frontend StorageResult) ---
class StorageResult(BaseModel):
    success: bool = True
    id: Optional[str] = None
    url: Optional[str] = None
    timestamp: Optional[str] = None
    action: Optional[str] = None
    size: Optional[int] = None
    folder: Optional[str] = None
    error: Optional[str] = None

class SortBy(str, Enum):
    date = "date"
    name = "name"
    author = "author"
    rating = "rating"

# --- ASYNC HELPERS ---

def get_config(item_type: str):
    return STORAGE_MAP.get(item_type, STORAGE_MAP["default"])

async def ensure_folder(sftp, folder):
    try:
        await run_sftp(sftp.chdir, folder)
    except IOError:
        await run_sftp(sftp.mkdir, folder)
        await run_sftp(sftp.chdir, folder)

async def read_json(sftp, filename):
    try:
        with sftp.open(filename, 'r') as f:
            # json.load is blocking CPU bound, but fast for small files
            return json.load(f)
    except Exception:
        return []

async def write_json(sftp, filename, data):
    # Use binary mode + encode to ensure compatibility with Paramiko SFTPFile
    with sftp.open(filename, 'wb') as f:
        f.write(json.dumps(data).encode('utf-8'))

# --- ENDPOINTS ---

@app.get("/")
def home():
    return {"status": "online", "service": "Hyphon Cloud Storage vPerformance"}

# --- LISTING (Cached) ---
@app.get("/api/songs", response_model=List[MetaData])
async def list_library(
    type: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Search name, author, or description"),
    sort_by: SortBy = Query(SortBy.date),
    sort_desc: bool = Query(True),
    genre: Optional[str] = Query(None),
    min_rating: Optional[int] = Query(None, ge=1, le=10)
):
    cache_key = f"library:{type or 'all'}:{search}:{sort_by}:{sort_desc}:{genre}:{min_rating}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    sftp, transport = await sftp_pool.acquire()
    results = []

    try:
        # We need to remember root to navigate up/down
        root = await run_sftp(sftp.getcwd)

        search_types = [type] if type else ["song", "pattern", "bank", "sample", "music", "shader", "note"]

        for t in search_types:
            config = get_config(t)
            try:
                # Run the chdir + read in one thread block to avoid hopping
                def _fetch_list():
                    try:
                        sftp.chdir(config["folder"])
                        # Use json.load directly on file obj (works if paramiko supports it or text mode)
                        # To be safe against binary/text issues in read, we wrap:
                        with sftp.open(config["index"], 'r') as f:
                            data = json.load(f)
                        sftp.chdir(root)
                        return data
                    except:
                        sftp.chdir(root)
                        return []

                items = await run_sftp(_fetch_list)
                if isinstance(items, list):
                    results.extend(items)
            except Exception as e:
                print(f"Error listing {t}: {e}")

        # Search filter (exactly what frontend expects)
        if search:
            search_lower = search.lower()
            results = [
                r for r in results
                if search_lower in str(r.get("name", "")).lower()
                or search_lower in str(r.get("author", "")).lower()
                or search_lower in str(r.get("description", "")).lower()
            ]

        # Existing filters
        if genre:
            results = [r for r in results if r.get("genre") == genre]
        if min_rating is not None:
            results = [r for r in results if (r.get("rating") or 0) >= min_rating]

        # Sort
        def sort_key(item):
            val = item.get(sort_by.value)
            return (1, "") if val is None else (0, val)
        results.sort(key=sort_key, reverse=sort_desc)

        # Cache for 30s
        await cache.set(cache_key, results, ttl=30)
        return results
    finally:
        await sftp_pool.release(sftp, transport)

# --- FETCH ITEM ---
@app.get("/api/songs/{item_id}")
async def get_item(item_id: str, type: Optional[str] = Query(None)):
    sftp, transport = await sftp_pool.acquire()
    try:
        root = await run_sftp(sftp.getcwd)
        search_order = [type] if type else ["song", "pattern", "bank"]

        file_data = None

        def _find_and_read():
            for t in search_order:
                config = get_config(t)
                try:
                    sftp.chdir(config["folder"])
                    with sftp.open(f"{item_id}.json", 'r') as f:
                        data = json.load(f)
                    sftp.chdir(root)
                    return data
                except:
                    sftp.chdir(root)
            return None

        file_data = await run_sftp(_find_and_read)

        if not file_data:
            raise HTTPException(404, "Item not found")
        return file_data
    finally:
        await sftp_pool.release(sftp, transport)

# --- UPLOAD JSON ---
@app.post("/api/songs")
async def upload_item(payload: ItemPayload):
    item_id = str(uuid.uuid4())
    date_str = datetime.now().strftime("%Y-%m-%d")
    item_type = payload.type if payload.type in STORAGE_MAP else "song"
    config = get_config(item_type)

    meta = {
        "id": item_id,
        "name": payload.name,
        "author": payload.author,
        "date": date_str,
        "type": item_type,
        "description": payload.description,
        "filename": f"{item_id}.json",
        "size": 0,
        "url": f"/api/songs/{item_id}",
        "version": 1,
        "tags": payload.tags or [],
        "folder": payload.folder or "default"
    }
    payload.data["_cloud_meta"] = meta

    async with INDEX_LOCK: # Prevent concurrent index writes
        sftp, transport = await sftp_pool.acquire()
        try:
            def _perform_write():
                root = sftp.getcwd()
                try:
                    # Ensure folder exists
                    try: sftp.chdir(config["folder"])
                    except:
                        sftp.mkdir(config["folder"])
                        sftp.chdir(config["folder"])

                    # Write file (Safe Mode: Binary + Encode)
                    json_bytes = json.dumps(payload.data).encode('utf-8')
                    with sftp.open(meta['filename'], 'wb') as f:
                        f.write(json_bytes)

                    # --- VERIFICATION ---
                    # Immediate read-back to confirm data integrity
                    # We read as binary to avoid encoding ambiguities during verify
                    with sftp.open(meta['filename'], 'rb') as f_check:
                        written_bytes = f_check.read()
                        if written_bytes != json_bytes:
                            raise Exception("Verification Failed: Data mismatch on disk")
                    # --------------------

                    # Update Index
                    try:
                        with sftp.open(config["index"], 'r') as f:
                            current = json.load(f)
                    except:
                        current = []

                    current.insert(0, meta)

                    # Write Index (Safe Mode)
                    with sftp.open(config["index"], 'wb') as f:
                        f.write(json.dumps(current).encode('utf-8'))

                    sftp.chdir(root)
                except Exception as e:
                    sftp.chdir(root)
                    raise e
    
            await run_sftp(_perform_write)
            # Calculate size from the JSON data
            json_bytes = json.dumps(payload.data).encode('utf-8')
            size = len(json_bytes)
            
            # Invalidate cache
            await cache.delete(f"library:{item_type}")
            await cache.delete("library:all")
            
            return StorageResult(
                success=True,
                id=item_id,
                url=f"/api/songs/{item_id}",
                timestamp=date_str,
                action="created",
                size=size,
                folder=payload.folder or "default"
            )
        except Exception as e:
            print(f"Upload Error: {e}")
            raise HTTPException(500, str(e))
        finally:
            await sftp_pool.release(sftp, transport)

# ====================== DELETE ENDPOINT ======================
@app.delete("/api/songs/{item_id}")
async def delete_item(item_id: str, type: Optional[str] = Query(None)):
    """
    Deletes item + removes from index.
    Called by CloudStorage.deleteItem().
    """
    search_types = [type] if type else ["song", "pattern", "bank", "sample", "music", "note", "shader"]

    async with INDEX_LOCK:
        sftp, transport = await sftp_pool.acquire()
        try:
            root = await run_sftp(sftp.getcwd)
            
            for t in search_types:
                config = get_config(t)

                # Try to delete the file (most are {id}.json)
                def _check_and_delete():
                    try:
                        sftp.chdir(config["folder"])
                        file_path = f"{item_id}.json"
                        try:
                            sftp.remove(file_path)
                            return True
                        except:
                            return False
                    except:
                        return False
                    finally:
                        try:
                            sftp.chdir(root)
                        except:
                            pass
                
                deleted = await run_sftp(_check_and_delete)

                # For samples/music that store original filename in index
                def _remove_from_index():
                    try:
                        sftp.chdir(config["folder"])
                        try:
                            with sftp.open(config["index"], 'r') as f:
                                current = json.load(f)
                        except:
                            current = []
                        
                        entry = next((item for item in current if item.get("id") == item_id), None)
                        
                        # Remove from index
                        if isinstance(current, list):
                            new_index = [item for item in current if item.get("id") != item_id]
                            with sftp.open(config["index"], 'wb') as f:
                                f.write(json.dumps(new_index).encode('utf-8'))
                        
                        sftp.chdir(root)
                        return entry
                    except Exception as e:
                        print(f"Error removing from index: {e}")
                        try:
                            sftp.chdir(root)
                        except:
                            pass
                        return None
                
                entry = await run_sftp(_remove_from_index)
                
                # Delete by filename if entry has one
                if entry and "filename" in entry:
                    def _delete_by_filename():
                        try:
                            sftp.chdir(config["folder"])
                            try:
                                sftp.remove(entry["filename"])
                            except:
                                pass
                            sftp.chdir(root)
                        except:
                            pass
                    await run_sftp(_delete_by_filename)

                if deleted or entry:
                    # Clear cache
                    await cache.delete(f"library:{t}")
                    await cache.delete("library:all")
                    
                    return StorageResult(
                        success=True,
                        id=item_id,
                        action="deleted"
                    )

            raise HTTPException(status_code=404, detail="Item not found")
        except HTTPException:
            raise
        except Exception as e:
            logging.error(f"Delete failed for {item_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")
        finally:
            await sftp_pool.release(sftp, transport)

# --- SAMPLES (Streaming) ---

@app.get("/api/samples", response_model=List[MetaData])
async def list_samples():
    cache_key = "library:sample"
    cached = await cache.get(cache_key)
    if cached: return cached

    sftp, transport = await sftp_pool.acquire()
    try:
        def _fetch():
            root = sftp.getcwd()
            try:
                sftp.chdir(STORAGE_MAP["sample"]["folder"])
                data = json.load(sftp.open(STORAGE_MAP["sample"]["index"]))
                sftp.chdir(root)
                return data
            except:
                sftp.chdir(root)
                return []

        res = await run_sftp(_fetch)
        await cache.set(cache_key, res, ttl=30)
        return res
    finally:
        await sftp_pool.release(sftp, transport)

@app.post("/api/samples")
async def upload_sample(file: UploadFile = File(...), author: str = Form(...), description: str = Form("")):
    sample_id = str(uuid.uuid4())
    date_str = datetime.now().strftime("%Y-%m-%d")
    ext = os.path.splitext(file.filename)[1]
    storage_filename = f"{sample_id}{ext}"
    config = STORAGE_MAP["sample"]

    meta = {
        "id": sample_id,
        "name": file.filename,
        "author": author,
        "date": date_str,
        "type": "sample",
        "description": description,
        "filename": storage_filename
    }

    async with INDEX_LOCK: # Protect Sample Index
        sftp, transport = await sftp_pool.acquire()
        try:
            # Prepare path in main thread logic, execute in thread
            root = await run_sftp(sftp.getcwd)
            await ensure_folder(sftp, config["folder"])
    
            try:
                # Open file handle in thread
                f_remote = await run_sftp(sftp.open, storage_filename, 'wb')

                # Stream upload (Async Read -> Threaded Write)
                # This is the non-blocking magic
                while True:
                    chunk = await file.read(1024 * 1024) # 1MB
                    if not chunk: break
                    await run_sftp(f_remote.write, chunk)

                await run_sftp(f_remote.close)
    
                # Update Index
                def _update_idx():
                    try:
                        idx = json.load(sftp.open(config["index"]))
                    except: idx = []
                    idx.insert(0, meta)

                    # Safe Write
                    with sftp.open(config["index"], 'wb') as f:
                        f.write(json.dumps(idx).encode('utf-8'))

                await run_sftp(_update_idx)

                # Reset
                await run_sftp(sftp.chdir, root)

                # Invalidate cache
                await cache.delete("library:sample")
                return {"success": True, "id": sample_id}
    
            except Exception as e:
                await run_sftp(sftp.chdir, root)
                raise e
        except Exception as e:
            raise HTTPException(500, str(e))
        finally:
            await sftp_pool.release(sftp, transport)

@app.get("/api/samples/{sample_id}")
async def get_sample(sample_id: str):
    # Acquire a dedicated connection for streaming
    # We DO NOT release it in the finally block of this function
    # It gets released by the generator when done
    sftp, transport = await sftp_pool.acquire()

    try:
        config = STORAGE_MAP["sample"]

        # Locate file logic (threaded)
        def _locate():
            root = sftp.getcwd()
            sftp.chdir(config["folder"])
            try:
                idx = json.load(sftp.open(config["index"]))
                entry = next((i for i in idx if i["id"] == sample_id), None)
                if not entry: raise FileNotFoundError

                # Return file handle
                file_obj = sftp.open(entry['filename'], 'rb')
                # Prefetch allows faster streaming
                file_obj.prefetch()
                return file_obj, entry['name']
            except Exception:
                sftp.chdir(root)
                raise

        file_obj, filename = await run_sftp(_locate)

        # Generator that streams and closes connection at end
        async def file_iterator():
            try:
                while True:
                    # Read in thread
                    chunk = await run_sftp(file_obj.read, 32768)
                    if not chunk: break
                    yield chunk
            finally:
                await run_sftp(file_obj.close)
                # Return root
                try: await run_sftp(sftp.chdir, "..")
                except: pass
                # Release connection back to pool
                await sftp_pool.release(sftp, transport)

        return StreamingResponse(
            file_iterator(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        # If error before streaming starts, release now
        await sftp_pool.release(sftp, transport)
        raise HTTPException(404, "Sample not found")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)