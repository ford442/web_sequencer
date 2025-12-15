import os
import json
import uuid
import paramiko
import uvicorn
import asyncio
import socket
from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from aiocache import Cache

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

# --- EXECUTOR & CACHE ---
io_executor = ThreadPoolExecutor(max_workers=10)
cache = Cache(Cache.MEMORY)

# --- GLOBAL LOCK ---
# Protects against concurrent index writes across threads/requests
INDEX_LOCK = None

async def run_sftp(func, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(io_executor, lambda: func(*args, **kwargs))

# --- FIXED CONNECTION POOL ---
class SFTPPool:
    def __init__(self, min_size=2, max_size=10):
        self.pool = asyncio.Queue(maxsize=max_size)
        self.max_size = max_size
        self._lock = asyncio.Lock()
        self._size = 0
        self.home_path = None

    async def initialize(self):
        print("🔌 Pool: Pre-filling...")
        for _ in range(self.max_size): # Pre-fill slightly more aggressive
             if self._size < self.max_size:
                conn = await self._create_connection()
                if conn:
                    await self.pool.put(conn)

    async def _create_connection(self):
        """Create new connection with timeout"""
        try:
            def _connect():
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5)
                sock.connect((FTP_HOST, FTP_PORT))

                t = paramiko.Transport(sock)
                t.connect(username=FTP_USER, password=FTP_PASS)
                t.set_keepalive(15)

                sftp = paramiko.SFTPClient.from_transport(t)
                if self.home_path is None:
                    try: self.home_path = sftp.normalize('.')
                    except: pass
                return sftp, t

            # Add 10 second timeout to connection creation
            sftp, t = await asyncio.wait_for(run_sftp(_connect), timeout=10.0)

            async with self._lock:
                self._size += 1
            print(f"🔌 Pool: Connection created (size: {self._size})")
            return sftp, t
        except Exception as e:
            # FIXED: Added variable 'e' to f-string
            print(f"❌ Pool: Creation failed: {e}")
            return None

    async def acquire(self):
        """Get connection with non-blocking health check"""
        async with self._lock:
            if self._size == 0:
                return await self._create_connection()

        # Try to get from pool with timeout
        try:
            sftp, transport = await asyncio.wait_for(self.pool.get(), timeout=0.5)
        except asyncio.TimeoutError:
            # Pool empty but size < max, create new
            async with self._lock:
                if self._size < self.max_size:
                    return await self._create_connection()
                else:
                    # Wait longer if we are maxed out
                    sftp, transport = await self.pool.get()

        # Fast health check
        if transport.is_active():
            try:
                # Reset path only
                def _reset():
                    if self.home_path:
                        try: sftp.chdir(self.home_path)
                        except: pass
                    try: sftp.chdir(BASE_DIR)
                    except IOError:
                        sftp.mkdir(BASE_DIR)
                        sftp.chdir(BASE_DIR)

                await run_sftp(_reset)
                return sftp, transport
            except:
                pass

        # Connection dead, dispose and create new
        print("♻️ Pool: Recycling dead connection")
        async with self._lock:
            self._size -= 1
        await self._dispose(sftp, transport)

        new_conn = await self._create_connection()
        if not new_conn:
             raise HTTPException(503, "Storage unavailable")
        return new_conn

    async def release(self, sftp, transport):
        """Return connection to pool or dispose if full"""
        if not transport.is_active():
            async with self._lock:
                self._size -= 1
            return

        try:
            self.pool.put_nowait((sftp, transport))
        except asyncio.QueueFull:
            async with self._lock:
                self._size -= 1
            await self._dispose(sftp, transport)

    async def _dispose(self, sftp, transport):
        def _close():
            try: sftp.close()
            except: pass
            try: transport.close()
            except: pass
        await run_sftp(_close)

    async def close_all(self):
        while not self.pool.empty():
            sftp, t = await self.pool.get()
            await self._dispose(sftp, t)
        async with self._lock:
            self._size = 0

sftp_pool = SFTPPool(min_size=2, max_size=10)

# --- LIFESPAN ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global INDEX_LOCK
    INDEX_LOCK = asyncio.Lock()
    await sftp_pool.initialize()
    print("--- SERVER STARTUP: Ready ---")
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

class MetaData(BaseModel):
    id: str
    name: str
    author: str
    date: str
    type: str
    description: Optional[str] = ""
    filename: str

# --- HELPERS ---
def get_config(item_type: str):
    return STORAGE_MAP.get(item_type, STORAGE_MAP["default"])

# --- ENDPOINTS ---

@app.get("/")
def home():
    return {"status": "online", "service": "Electribe Cloud Storage vTimeoutProtected"}

@app.get("/api/songs", response_model=List[MetaData])
async def list_library(type: Optional[str] = Query(None)):
    cache_key = f"library:{type or 'all'}"
    cached = await cache.get(cache_key)
    if cached: return cached

    sftp, transport = await sftp_pool.acquire()
    try:
        results = []
        types = [type] if type else ["song", "pattern", "bank"]

        for t in types:
            config = get_config(t)
            def _fetch():
                try:
                    sftp.chdir(config["folder"])
                    data = json.load(sftp.open(config["index"]))
                    sftp.chdir("..")
                    return data
                except:
                    try: sftp.chdir("..")
                    except: pass
                    return []
            results.extend(await run_sftp(_fetch))

        await cache.set(cache_key, results, ttl=10)
        return results
    except Exception as e:
        print(f"List Error: {e}")
        raise HTTPException(500, f"Server Error: {str(e)}")
    finally:
        await sftp_pool.release(sftp, transport)

@app.get("/api/songs/{item_id}")
async def get_item(item_id: str, type: Optional[str] = Query(None)):
    sftp, transport = await sftp_pool.acquire()
    try:
        search = [type] if type else ["song", "pattern", "bank"]

        def _find():
            for t in search:
                config = get_config(t)
                try:
                    sftp.chdir(config["folder"])
                    try:
                        with sftp.open(f"{item_id}.json", 'r') as f:
                            data = json.load(f)
                        sftp.chdir("..")
                        return data
                    except: pass
                    sftp.chdir("..")
                except: pass
            return None

        data = await run_sftp(_find)
        if not data: raise HTTPException(404, "Not found")
        return data
    except Exception as e:
        if "404" in str(e): raise e
        raise HTTPException(500, f"Server Error: {str(e)}")
    finally:
        await sftp_pool.release(sftp, transport)

# --- FIXED UPLOAD ITEM (Added Timeout, Compat Fix, Lock) ---
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
        "filename": f"{item_id}.json"
    }
    payload.data["_cloud_meta"] = meta

    try:
        # Compatibility Fix: Use wait_for instead of asyncio.timeout (Python < 3.11)
        async def _upload_logic():
            # Acquire global lock to protect index writes
            async with INDEX_LOCK:
                sftp, transport = await sftp_pool.acquire()
                try:
                    def _write():
                        try: sftp.chdir(config["folder"])
                        except:
                            sftp.mkdir(config["folder"])
                            sftp.chdir(config["folder"])

                        # Safe Mode: Binary + Encode
                        with sftp.open(meta['filename'], 'wb') as f:
                            f.write(json.dumps(payload.data).encode('utf-8'))

                        try:
                            with sftp.open(config["index"], 'rb') as f:
                                idx = json.load(f)
                        except: idx = []

                        idx = [i for i in idx if i.get('id') != item_id]
                        idx.insert(0, meta)

                        # Safe Mode: Binary + Encode
                        with sftp.open(config["index"], 'wb') as f:
                            f.write(json.dumps(idx).encode('utf-8'))

                        sftp.chdir("..")

                    await run_sftp(_write)
                    await cache.clear()
                    return {"success": True, "id": item_id}
                finally:
                    await sftp_pool.release(sftp, transport)

        return await asyncio.wait_for(_upload_logic(), timeout=30.0)

    except asyncio.TimeoutError:
        print("❌ Upload timed out")
        raise HTTPException(503, "Upload operation timed out")
    except Exception as e:
        print(f"Upload Error: {e}")
        raise HTTPException(500, detail=f"Upload Error: {str(e)}")

@app.get("/api/samples", response_model=List[MetaData])
async def list_samples():
    sftp, transport = await sftp_pool.acquire()
    try:
        def _fetch():
            try:
                sftp.chdir(STORAGE_MAP["sample"]["folder"])
                data = json.load(sftp.open(STORAGE_MAP["sample"]["index"]))
                sftp.chdir("..")
                return data
            except:
                try: sftp.chdir("..")
                except: pass
                return []
        return await run_sftp(_fetch)
    finally:
        await sftp_pool.release(sftp, transport)

@app.post("/api/samples")
async def upload_sample(file: UploadFile = File(...), author: str = Form(...), description: str = Form("")):
    sample_id = str(uuid.uuid4())
    date_str = datetime.now().strftime("%Y-%m-%d")
    ext = os.path.splitext(file.filename)[1]
    fname = f"{sample_id}{ext}"
    config = STORAGE_MAP["sample"]

    meta = {
        "id": sample_id,
        "name": file.filename,
        "author": author,
        "date": date_str,
        "type": "sample",
        "description": description,
        "filename": fname
    }

    try:
        # Compatibility Fix: Use wait_for instead of asyncio.timeout
        async def _upload_logic():
            # Acquire global lock to protect index writes
            async with INDEX_LOCK:
                sftp, transport = await sftp_pool.acquire()
                try:
                    def _upload_bin():
                        try: sftp.chdir(config["folder"])
                        except:
                            sftp.mkdir(config["folder"])
                            sftp.chdir(config["folder"])
                        return sftp.open(fname, 'wb')

                    f_remote = await run_sftp(_upload_bin)

                    try:
                        while True:
                            chunk = await file.read(1024 * 1024)
                            if not chunk: break
                            await run_sftp(f_remote.write, chunk)
                    finally:
                        await run_sftp(f_remote.close)

                    def _finalize():
                        try: idx = json.load(sftp.open(config["index"]))
                        except: idx = []
                        idx.insert(0, meta)

                        # Safe Mode: Binary + Encode
                        with sftp.open(config["index"], 'wb') as f:
                            f.write(json.dumps(idx).encode('utf-8'))

                        sftp.chdir("..")

                    await run_sftp(_finalize)
                    return {"success": True, "id": sample_id}
                finally:
                    await sftp_pool.release(sftp, transport)

        return await asyncio.wait_for(_upload_logic(), timeout=60.0)

    except asyncio.TimeoutError:
        raise HTTPException(503, "Sample upload timed out")
    except Exception as e:
        raise HTTPException(500, detail=str(e))

# --- FIXED GET SAMPLE ENDPOINT (Syntax corrected) ---
@app.get("/api/samples/{sample_id}")
async def get_sample(sample_id: str):
    sftp, transport = await sftp_pool.acquire()
    file_obj = None

    try:
        config = STORAGE_MAP["sample"]

        def _open():
            sftp.chdir(config["folder"])
            idx = json.load(sftp.open(config["index"]))
            entry = next((i for i in idx if i["id"] == sample_id), None)
            if not entry: raise FileNotFoundError

            f = sftp.open(entry['filename'], 'rb')
            f.prefetch()
            return f, entry['name']

        file_obj, fname = await run_sftp(_open)

        async def iterfile():
            try:
                while True:
                    data = await run_sftp(file_obj.read, 32768)
                    if not data: break
                    yield data
            finally:
                await run_sftp(file_obj.close)
                await sftp_pool.release(sftp, transport)

        return StreamingResponse(
            iterfile(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={fname}"}
        )
    except FileNotFoundError:
        # If open failed, we must release here because iterfile won't run
        await sftp_pool.release(sftp, transport)
        raise HTTPException(404, "Sample not found")
    except Exception as e:
        # FIXED: Added variable 'e' to f-string
        print(f"Sample download error: {e}")
        # Release if we failed before streaming started
        if file_obj is None:
            await sftp_pool.release(sftp, transport)
        raise HTTPException(500, f"Server Error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)