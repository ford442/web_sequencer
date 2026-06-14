sed -i 's/- \[ \] \*\*Time-Stretch Envelope:\*\*/- \[x\] \*\*Time-Stretch Envelope:\*\*/g' agent_plan.md
sed -i '/- \[x\] \*\*Time-Stretch Envelope:\*\*/a \  - Implemented: per-step + global `timeStretchEnvDepth` fully wired through SingingVoice → rubberband Worklet. Pairs beautifully with Formant Envelope Sync.' agent_plan.md
