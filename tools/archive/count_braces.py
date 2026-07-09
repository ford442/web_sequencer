def count_braces(filename):
    with open(filename, 'r') as f:
        lines = f.readlines()
    o = sum(l.count('{') for l in lines)
    c = sum(l.count('}') for l in lines)
    print(f"Braces in {filename}: Open={o}, Close={c}, Diff={o-c}")

count_braces('src/hooks/audioEngine/audioPlayback.ts')
