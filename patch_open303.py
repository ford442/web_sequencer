import os

filepath = 'src/audio-worklets/open303-processor.ts'

with open(filepath, 'r') as f:
    content = f.read()

search_str = """                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                }
            } else {"""

replace_str = """                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                }

                // Free the allocated buffer to prevent memory leak
                if (exports._free) {
                    exports._free(ptr);
                }
            } else {"""

if search_str in content:
    new_content = content.replace(search_str, replace_str)
    with open(filepath, 'w') as f:
        f.write(new_content)
    print("Successfully patched open303-processor.ts")
else:
    print("Could not find search string in open303-processor.ts")
    # Print the area where we expect it to help debugging
    start_idx = content.find("if (offset >= 0")
    if start_idx != -1:
        print("Context around failure:")
        print(content[start_idx:start_idx+500])
