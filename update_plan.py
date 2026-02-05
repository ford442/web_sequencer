import re
with open('agent_plan.md', 'r') as f:
    content = f.read()

content = re.sub(r"-\s*\[\s*\]\s*\*\*Phoneme Elasticity\*\*", "- [x] **Phoneme Elasticity**", content)

with open('agent_plan.md', 'w') as f:
    f.write(content)
