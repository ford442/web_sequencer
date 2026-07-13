import sys
content = open(sys.argv[1]).read()
print(f"{{: {content.count('{')}")
print(f"}}: {content.count('}')}")
print(f"(: {content.count('(')}")
print(f"): {content.count(')')}")
