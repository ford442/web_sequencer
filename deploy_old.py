import os
import paramiko
import getpass

# --- Server Configuration ---
# Replace these with your server's details.
# It's better to use environment variables or a config file for sensitive data.
HOSTNAME = "1ink.us"
PORT = 22  # Default SFTP/SSH port
USERNAME = "ford442"

# --- Project Configuration ---
# The local directory to upload from.
LOCAL_DIRECTORY = "dist"
# The directory on the server where the files should go (e.g., 'public_html/wasm-game').
REMOTE_DIRECTORY = "test.1ink.us/hyphon"

# --- WASM Files Configuration ---
# Remote directory for JC-303 WASM/JS assets
WASM_REMOTE_DIRECTORY = "wasm.noahcohn.com"
# Local directories to search for WASM assets
WASM_SOURCE_DIRS = ["dist", "public"]
# File patterns to upload (base names without extension)
WASM_FILE_BASES = ["jc303-single", "jc303-threaded", "jc303"]
# Extensions to upload for each base
WASM_FILE_EXTENSIONS = [".js", ".wasm", ".worker.js"]

def upload_directory(sftp_client, local_path, remote_path):
    """
    Recursively uploads a directory and its contents to the remote server.
    """
    print(f"Creating remote directory: {remote_path}")
    try:
        # Create the target directory on the server if it doesn't exist.
        sftp_client.mkdir(remote_path)
    except IOError:
        # Directory already exists, which is fine.
        print(f"Directory {remote_path} already exists.")

    for item in os.listdir(local_path):
        local_item_path = os.path.join(local_path, item)
        remote_item_path = f"{remote_path}/{item}"

        if os.path.isfile(local_item_path):
            print(f"Uploading file: {local_item_path} -> {remote_item_path}")
            sftp_client.put(local_item_path, remote_item_path)
        elif os.path.isdir(local_item_path):
            # If it's a directory, recurse into it.
            upload_directory(sftp_client, local_item_path, remote_item_path)

def upload_wasm_files(sftp_client):
    """
    Upload JC-303 WASM/JS assets to the dedicated WASM host directory.
    Searches dist/ and public/ for the files.
    """
    print(f"\n📦 Uploading WASM assets to '{WASM_REMOTE_DIRECTORY}'...")
    try:
        sftp_client.mkdir(WASM_REMOTE_DIRECTORY)
    except IOError:
        print(f"Directory {WASM_REMOTE_DIRECTORY} already exists.")

    uploaded = 0
    for base in WASM_FILE_BASES:
        for ext in WASM_FILE_EXTENSIONS:
            filename = base + ext
            local_path = None
            for src_dir in WASM_SOURCE_DIRS:
                candidate = os.path.join(src_dir, filename)
                if os.path.isfile(candidate):
                    local_path = candidate
                    break
            if local_path:
                remote_path = f"{WASM_REMOTE_DIRECTORY}/{filename}"
                print(f"Uploading WASM asset: {local_path} -> {remote_path}")
                sftp_client.put(local_path, remote_path)
                uploaded += 1
            else:
                print(f"⚠️  Skipping {filename} (not found in {WASM_SOURCE_DIRS})")

    print(f"✅ Uploaded {uploaded} WASM asset(s)")

def main():
    """
    Main function to connect to the server and start the upload process.
    """
    password = 'GoogleBez12!' # getpass.getpass(f"Enter password for {USERNAME}@{HOSTNAME}: ")

    transport = None
    sftp = None
    try:
        # Establish the SSH connection
        transport = paramiko.Transport((HOSTNAME, PORT))
        print("Connecting to server...")
        transport.connect(username=USERNAME, password=password)
        print("Connection successful!")

        # Create an SFTP client from the transport
        sftp = paramiko.SFTPClient.from_transport(transport)
        print(f"Starting upload of '{LOCAL_DIRECTORY}' to '{REMOTE_DIRECTORY}'...")

        # Start the recursive upload
        upload_directory(sftp, LOCAL_DIRECTORY, REMOTE_DIRECTORY)

        # Upload JC-303 WASM/JS assets to wasm.noahcohn.com
        upload_wasm_files(sftp)

        print("\n✅ Deployment complete!")

    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        # Ensure the connection is closed
        if sftp:
            sftp.close()
        if transport:
            transport.close()
        print("Connection closed.")

if __name__ == "__main__":
    if not os.path.exists(LOCAL_DIRECTORY):
        print(f"Error: Local directory '{LOCAL_DIRECTORY}' not found. Did you run 'npm run build' first?")
    else:
        main()
