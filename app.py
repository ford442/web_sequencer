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
from typing import List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# --- CONFIGURATION ---
FTP_HOST = os.environ.get("FTP_HOST")
FTP_USER = os.environ.get("FTP_USER")
FTP_PASS = os.environ.get("FTP_PASS")
FTP_PORT = int(os.environ.get("FTP_PORT", 22)) 
BASE_DIR = os.environ.get("FTP_DIR", "storage.1ink.us") 

# --- TYPE DEFINITIONS ---
# Map types to specific subfolders and index filenames
STORAGE_MAP = {
    "song":     {"folder": "songs",    "index": "_songs.json"},
    "pattern":  {"folder": "patterns", "index": "_patterns.json"},
    "bank":     {"folder": "banks",    "index": "_banks.json"},
    "sample":   {"folder": "samples",  "index": "_samples.json"},
    # Fallback
    "default":  {"folder": "misc",     "index": "_misc.json"}
}

# --- CONCURRENCY LOCK ---
INDEX_LOCK = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global INDEX_LOCK
    INDEX_LOCK = asyncio.Lock()
    print("--- SERVER STARTUP: Lock Initialized ---")
    yield

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

# --- SFTP HELPERS ---

def get_storage_config(item_type: str):
    return STORAGE_MAP.get(item_type, STORAGE_MAP["default"])

def get_sftp_connection():
    """
    Establishes SFTP connection and ensures BASE_DIR exists.
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)
        sock.connect((FTP_HOST, FTP_PORT))

        transport = paramiko.Transport(sock)
        transport.connect(username=FTP_USER, password=FTP_PASS)
        sftp = paramiko.SFTPClient.from_transport(transport)
        
        # Ensure Base Directory
        try:
            if BASE_DIR.startswith("/"):
                sftp.chdir(BASE_DIR)
            else:
                try:
                    sftp.chdir(BASE_DIR)
                except IOError:
                    sftp.mkdir(BASE_DIR)
                    sftp.chdir(BASE_DIR)
        except Exception:
            pass # Try to proceed if chdir fails (permissions etc)
            
        return sftp, transport
    except Exception as e:
        print(f"SFTP Connection Failed: {e}")
        raise HTTPException(status_code=503, detail=f"Storage unavailable: {str(e)}")

def ensure_folder(sftp, folder_name):
    try:
        sftp.chdir(folder_name)
    except IOError:
        sftp.mkdir(folder_name)
        sftp.chdir(folder_name)

def read_json_index(sftp, index_filename):
    try:
        with sftp.open(index_filename, 'r') as f:
            return json.load(f)
    except Exception:
        return [] # Return empty list if file doesn't exist

def update_index_safely(sftp, index_filename, new_entry):
    current = read_json_index(sftp, index_filename)
    # Deduplicate (remove old entry if overwriting same ID, though we use UUIDs)
    current = [item for item in current if item['id'] != new_entry['id']]
    current.insert(0, new_entry)
    with sftp.open(index_filename, 'w') as f:
        json.dump(current, f)

# --- ENDPOINTS ---

@app.get("/")
def home():
    return {"status": "online", "service": "Electribe Cloud Storage v3"}

# --- JSON ITEMS (Songs, Patterns, Banks) ---

@app.get("/api/songs", response_model=List[MetaData])
async def list_library(type: Optional[str] = Query(None)):
    """
    Returns items. If 'type' param provided, returns only that list.
    Otherwise, merges Songs, Patterns, and Banks into one master list.
    """
    sftp, transport = get_sftp_connection()
    results = []
    
    try:
        # Determine which types to fetch
        types_to_fetch = [type] if type else ["song", "pattern", "bank"]
        
        for t in types_to_fetch:
            config = get_storage_config(t)
            # We don't need to enter the folder to read the index if we keep indices in root
            # BUT keeping indices inside folders is cleaner. Let's assume indices are in the type folder.
            
            try:
                # Enter folder
                current = sftp.getcwd()
                try:
                    sftp.chdir(config["folder"])
                    items = read_json_index(sftp, config["index"])
                    results.extend(items)
                except IOError:
                    pass # Folder doesn't exist yet, skip
                
                # Go back up
                sftp.chdir(current)
            except Exception as e:
                print(f"Error listing {t}: {e}")

        return results
    finally:
        sftp.close()
        transport.close()

@app.get("/api/songs/{item_id}")
async def get_item(item_id: str, type: Optional[str] = Query(None)):
    """
    Fetches a JSON item. 
    If 'type' is unknown, it will try to find the item in all folders.
    """
    sftp, transport = get_sftp_connection()
    try:
        # If we know the type, go straight there
        search_order = [type] if type else ["song", "pattern", "bank"]
        
        file_data = None
        
        for t in search_order:
            config = get_storage_config(t)
            current = sftp.getcwd()
            try:
                sftp.chdir(config["folder"])
                filename = f"{item_id}.json"
                try:
                    with sftp.open(filename, 'r') as f:
                        file_data = json.load(f)
                        break # Found it!
                except IOError:
                    pass # Not in this folder
            except IOError:
                pass # Folder issue
            finally:
                sftp.chdir(current) # Reset path
        
        if file_data:
            return file_data
        else:
            raise HTTPException(status_code=404, detail="Item not found")

    finally:
        sftp.close()
        transport.close()

@app.post("/api/songs")
async def upload_item(payload: ItemPayload):
    item_id = str(uuid.uuid4())
    date_str = datetime.now().strftime("%Y-%m-%d")
    
    # Identify configuration
    item_type = payload.type if payload.type in STORAGE_MAP else "song"
    config = get_storage_config(item_type)

    meta = {
        "id": item_id,
        "name": payload.name,
        "author": payload.author,
        "date": date_str,
        "type": item_type,
        "description": payload.description,
        "filename": f"{item_id}.json"
    }
    
    file_data = payload.data
    file_data["_cloud_meta"] = meta

    async with INDEX_LOCK:
        sftp, transport = get_sftp_connection()
        try:
            # 1. Enter/Create specific folder (e.g., "songs", "patterns")
            ensure_folder(sftp, config["folder"])
            
            # 2. Write File
            with sftp.open(meta['filename'], 'w') as f:
                json.dump(file_data, f)
            
            # 3. Update Index in that folder
            update_index_safely(sftp, config["index"], meta)
            
            return {"success": True, "id": item_id}
        finally:
            sftp.close()
            transport.close()

# --- SAMPLES (Binary) ---

@app.get("/api/samples", response_model=List[MetaData])
async def list_samples():
    sftp, transport = get_sftp_connection()
    try:
        config = get_storage_config("sample")
        try:
            sftp.chdir(config["folder"])
            return read_json_index(sftp, config["index"])
        except IOError:
            return []
    finally:
        sftp.close()
        transport.close()

@app.post("/api/samples")
async def upload_sample(file: UploadFile = File(...), author: str = Form(...), description: str = Form("")):
    sample_id = str(uuid.uuid4())
    date_str = datetime.now().strftime("%Y-%m-%d")
    ext = os.path.splitext(file.filename)[1]
    storage_filename = f"{sample_id}{ext}"
    
    config = get_storage_config("sample")

    meta = {
        "id": sample_id,
        "name": file.filename,
        "author": author,
        "date": date_str,
        "type": "sample",
        "description": description,
        "filename": storage_filename
    }

    async with INDEX_LOCK:
        sftp, transport = get_sftp_connection()
        try:
            ensure_folder(sftp, config["folder"])
            
            with sftp.open(storage_filename, 'wb') as f:
                while content := await file.read(1024 * 1024):
                    f.write(content)
            
            update_index_safely(sftp, config["index"], meta)
            return {"success": True, "id": sample_id}
        finally:
            sftp.close()
            transport.close()

@app.get("/api/samples/{sample_id}")
async def get_sample(sample_id: str):
    sftp, transport = get_sftp_connection()
    try:
        config = get_storage_config("sample")
        try:
            sftp.chdir(config["folder"])
            index = read_json_index(sftp, config["index"])
            entry = next((item for item in index if item["id"] == sample_id), None)
            
            if not entry:
                raise HTTPException(status_code=404, detail="Sample not found")
            
            buf = BytesIO()
            sftp.getfo(entry['filename'], buf)
            buf.seek(0)
            return StreamingResponse(buf, media_type="application/octet-stream")
        except IOError:
            raise HTTPException(status_code=404, detail="Folder/File missing")
    finally:
        sftp.close()
        transport.close()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
