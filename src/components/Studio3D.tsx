import React, { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, ContactShadows, Float, Stars } from '@react-three/drei';
import * as THREE from 'three';

interface Studio3DProps {
  header: React.ReactNode;
  sequencer: React.ReactNode;
  keyboard: React.ReactNode;
  rack: React.ReactNode;
  onExit: () => void;
}

// Custom First-Person Camera Rig with Parallax
const CameraRig = () => {
    const { camera } = useThree();
    const position = useRef(new THREE.Vector3(0, 5, 18)); // Initial position
    const keys = useRef(new Set<string>());

    // Use a ref to track mouse position globally, avoiding canvas raycasting interference
    const mouseRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => keys.current.add(e.code);
        const handleKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);

        const handleMouseMove = (e: MouseEvent) => {
            // Normalize to -1..1
            mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    useFrame((_state, delta) => {
        const speed = 15 * delta; // Movement speed
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        direction.y = 0; // Flatten movement to XZ plane
        direction.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(camera.up, direction).negate(); // Right vector

        // WASD Movement
        if (keys.current.has('KeyW')) position.current.addScaledVector(direction, speed);
        if (keys.current.has('KeyS')) position.current.addScaledVector(direction, -speed);
        if (keys.current.has('KeyA')) position.current.addScaledVector(right, -speed);
        if (keys.current.has('KeyD')) position.current.addScaledVector(right, speed);

        // Vertical Movement (Space/Shift)
        if (keys.current.has('Space')) position.current.y += speed;
        if (keys.current.has('ShiftLeft')) position.current.y -= speed;

        // Clamp Position (Stay within the "studio")
        position.current.x = Math.max(-20, Math.min(20, position.current.x));
        position.current.y = Math.max(1, Math.min(20, position.current.y));
        position.current.z = Math.max(5, Math.min(40, position.current.z));

        // Smoothly interpolate camera position
        camera.position.lerp(position.current, 0.1);

        // Parallax Look Logic
        const lookTarget = new THREE.Vector3(0, 0, 0); // Focus on the center stage

        // Use the global mouse ref instead of state.pointer
        lookTarget.x += mouseRef.current.x * 8;
        lookTarget.y += mouseRef.current.y * 5;

        camera.lookAt(lookTarget);
    });

    return null;
};

// Helper component to wrap DOM elements in 3D planes
const Panel = ({ children, position, rotation, scale = 1 }: any) => {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Html
        transform
        occlude="blending"
        style={{
          width: '1000px',
          height: 'auto',
          backgroundColor: 'rgba(0,0,0,0.8)',
          borderRadius: '12px',
          border: '1px solid rgba(6,182,212,0.3)',
          backdropFilter: 'blur(4px)',
          pointerEvents: 'auto'
        }}
      >
        {/* Stop propagation so clicks don't fall through to the scene */}
        <div className="w-[1000px] pointer-events-auto select-none" onPointerDown={(e) => e.stopPropagation()}>
          {children}
        </div>
      </Html>
    </group>
  );
};

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const Studio3D: React.FC<Studio3DProps> = React.memo(({ header, sequencer, keyboard, rack, onExit }) => {
  return (
    <div className="w-full h-screen bg-black">
      <Canvas camera={{ position: [0, 5, 18], fov: 50 }}>
        <color attach="background" args={['#050709']} />

        {/* Cinematic Lighting */}
        <ambientLight intensity={0.2} />
        <pointLight position={[10, 10, 10]} intensity={0.5} color="#06b6d4" />
        <pointLight position={[-10, 5, -10]} intensity={0.5} color="#a855f7" />
        <spotLight position={[0, 10, 0]} angle={0.5} penumbra={1} intensity={1} castShadow />

        {/* Environment */}
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

        {/* Custom First Person Camera - OrbitControls REMOVED */}
        <CameraRig />

        <Suspense fallback={null}>
          <group position={[0, -0.5, 0]}>
            
            {/* Header - Floating Top HUD */}
            <Float speed={2} rotationIntensity={0.1} floatIntensity={0.2}>
              <Panel position={[0, 3.5, -1]} rotation={[0.1, 0, 0]} scale={0.25}>
                {header}
                <div className="absolute top-2 right-2">
                    <button type="button"
                        onClick={onExit}
                        aria-label="Exit 3D View"
                        className="px-4 py-2 bg-red-900/50 border border-red-500 text-red-200 rounded font-orbitron text-xs hover:bg-red-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-red-500"
                    >
                        EXIT 3D VIEW
                    </button>
                </div>
              </Panel>
            </Float>

            {/* Sequencer - Main Desk */}
            <Panel position={[0, 0, 0]} rotation={[-0.2, 0, 0]} scale={0.3}>
              {sequencer}
            </Panel>

            {/* Keyboard - Lower Desk */}
            <Panel position={[0, -3.5, 1.5]} rotation={[-0.4, 0, 0]} scale={0.3}>
              {keyboard}
            </Panel>

            {/* Hardware Rack - Bottom/Front */}
            <Panel position={[0, -6.5, 3]} rotation={[-0.6, 0, 0]} scale={0.3}>
              {rack}
            </Panel>

          </group>

          {/* Floor Reflection */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -10, 0]}>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.1} metalness={0.8} />
          </mesh>
          <ContactShadows position={[0, -10, 0]} opacity={0.6} scale={40} blur={2} far={4} />
        </Suspense>
      </Canvas>

      {/* HUD Instructions */}
      <div className="absolute bottom-4 right-4 text-gray-500 text-xs font-mono pointer-events-none opacity-50">
          <p>WASD to Move • Shift/Space Up/Down</p>
      </div>
    </div>
  );
});
