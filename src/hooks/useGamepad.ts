import { useEffect, useRef } from 'react';

// Configuration for Key Mappings
const MAPPINGS = {
  // Player 1 (Usually Index 0)
  P1: {
    AXES: {
      UP: 'ArrowUp',
      DOWN: 'ArrowDown',
      LEFT: 'ArrowLeft',
      RIGHT: 'ArrowRight',
    },
    BUTTONS: {
      0: 'ControlLeft', // Attack
      1: 'AltLeft',     // Jump
      2: 'Space',       // Action 3
      3: 'ShiftLeft',   // Action 4
      4: 'KeyZ',        // Action 5
      5: 'KeyX',        // Action 6
      8: 'Digit5',      // Coin
      9: 'Digit1',      // Start
    } as Record<number, string>
  },
  // Player 2 (Usually Index 2 - skipping Ghost Index 1)
  P2: {
    AXES: {
      UP: 'KeyR',
      DOWN: 'KeyF',
      LEFT: 'KeyD',
      RIGHT: 'KeyG',
    },
    BUTTONS: {
      0: 'KeyA',
      1: 'KeyS',
      2: 'KeyQ',
      3: 'KeyW',
      4: 'KeyE',
      5: 'KeyT',
      8: 'Digit6',      // Coin P2
      9: 'Digit2',      // Start P2
    } as Record<number, string>
  }
};

type KeyState = { [key: string]: boolean };

export function useGamepad() {
  const requestRef = useRef<number | undefined>(undefined);
  const keyState = useRef<KeyState>({});

  useEffect(() => {
    // Helper to dispatch keyboard events
    const triggerKey = (code: string, type: 'keydown' | 'keyup') => {
      // Avoid repeating keyup events if already up, or keydown if already down
      if (type === 'keydown' && keyState.current[code]) return;
      if (type === 'keyup' && !keyState.current[code]) return;

      keyState.current[code] = type === 'keydown';

      const event = new KeyboardEvent(type, {
        code: code,
        key: code, // Simplification
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
    };

    const updateLoop = () => {
      const gamepads = navigator.getGamepads();

      // Filter out nulls and potential ghost devices (0 buttons)
      // We treat the first valid device as P1, second as P2
      let listIndex = 0;
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp || gp.buttons.length === 0) continue;

        // Determine if this is P1 or P2 based on the filtered list order
        // List Index 0 -> P1
        // List Index 1 -> P2

        let mapping = null;
        if (listIndex === 0) mapping = MAPPINGS.P1;
        if (listIndex === 1) mapping = MAPPINGS.P2;

        listIndex++;

        if (!mapping) continue;

        // 1. Handle Axes (Sticks)
        // Threshold for stick activation
        const THRESHOLD = 0.5;

        // Left/Right (Axis 0)
        if (gp.axes[0] < -THRESHOLD) triggerKey(mapping.AXES.LEFT, 'keydown');
        else triggerKey(mapping.AXES.LEFT, 'keyup');

        if (gp.axes[0] > THRESHOLD) triggerKey(mapping.AXES.RIGHT, 'keydown');
        else triggerKey(mapping.AXES.RIGHT, 'keyup');

        // Up/Down (Axis 1)
        if (gp.axes[1] < -THRESHOLD) triggerKey(mapping.AXES.UP, 'keydown');
        else triggerKey(mapping.AXES.UP, 'keyup');

        if (gp.axes[1] > THRESHOLD) triggerKey(mapping.AXES.DOWN, 'keydown');
        else triggerKey(mapping.AXES.DOWN, 'keyup');

        // 2. Handle Buttons
        for (let idx = 0; idx < gp.buttons.length; idx++) {
          const btn = gp.buttons[idx];
          const keyCode = mapping.BUTTONS[idx];
          if (keyCode) {
            triggerKey(keyCode, btn.pressed ? 'keydown' : 'keyup');
          }
        }
      }

      requestRef.current = requestAnimationFrame(updateLoop);
    };

    const onConnected = (e: GamepadEvent) => {
      console.log("Gamepad connected:", e.gamepad.id);
      // Ensure loop is running
      if (!requestRef.current) {
        requestRef.current = requestAnimationFrame(updateLoop);
      }
    };

    const onDisconnected = (e: GamepadEvent) => {
      console.log("Gamepad disconnected:", e.gamepad.id);
    };

    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);

    // Start polling immediately in case devices are already plugged in
    requestRef.current = requestAnimationFrame(updateLoop);

    return () => {
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = undefined;
      }
    };
  }, []);
}
