with open('agent_plan.md', 'r') as f:
    content = f.read()

target = "- [ ] **Phoneme Elasticity:**"
replacement = "- [x] **Phoneme Elasticity:**"

if target in content:
    content = content.replace(target, replacement)
    print("Replaced string literal")
else:
    print("String literal not found")
    print("Content snippet around Phoneme:")
    idx = content.find("Phoneme Elasticity")
    if idx != -1:
        print(repr(content[idx-10:idx+30]))

with open('agent_plan.md', 'w') as f:
    f.write(content)
