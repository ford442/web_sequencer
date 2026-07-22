import re

with open('.Jules/agent_plan.md', 'r') as f:
    content = f.read()

content = content.replace(
    "- [ ] Implement Phoneme Envelope shaping per step",
    "- [x] Implement Phoneme Envelope shaping per step"
)

with open('.Jules/agent_plan.md', 'w') as f:
    f.write(content)

print("Patched agent_plan.md")
