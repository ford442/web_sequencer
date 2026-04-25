with open('src/App.tsx', 'r') as f:
    content = f.read()

# Fix contextMenu.track TS2367 errors (App.tsx: 1394-1398)
content = content.replace("contextMenu.track !== 'sampler'", "(contextMenu.track as string) !== 'sampler'")

with open('src/App.tsx', 'w') as f:
    f.write(content)
