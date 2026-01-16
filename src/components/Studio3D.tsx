import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, ContactShadows, Float, Stars } from '@react-three/drei';

interface Studio3DProps {
  header: React.ReactNode;
  sequencer: React.ReactNode;
  keyboard: React.ReactNode;
  rack: React.ReactNode;
  onExit: () => void;
}

// Helper component to wrap DOM elements in 3D planes
const Panel = ({ children, position, rotation, scale = 1 }: any) => {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Html
        transform
        occlude="blending"
        style={{
          width: '1000px', // Matches your UI max-width
          height: 'auto',
          backgroundColor: 'rgba(0,0,0,0.8)',
          borderRadius: '12px',
          border: '1px solid rgba(6,182,212,0.3)',
          backdropFilter: 'blur(4px)',
          pointerEvents: 'auto'
        }}
      >
        {/* Stop propagation to prevent OrbitControls from hijacking clicks */}
        <div className="w-[1000px] pointer-events-auto select-none" onPointerDown={(e) => e.stopPropagation()}>
          {children}
        </div>
      </Html>
    </group>
  );
};

export const Studio3D: React.FC<Studio3DProps> = ({ header, sequencer, keyboard, rack, onExit }) => {
  return (
    <div className="w-full h-screen bg-black">
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <color attach="background" args={['#050709']} />

        {/* Cinematic Lighting */}
        <ambientLight intensity={0.2} />
        <pointLight position={[10, 10, 10]} intensity={0.5} color="#06b6d4" />
        <pointLight position={[-10, 5, -10]} intensity={0.5} color="#a855f7" />
        <spotLight position={[0, 10, 0]} angle={0.5} penumbra={1} intensity={1} castShadow />

        {/* Environment */}
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

        {/* Camera Controls */}
        <OrbitControls
            enablePan={false}
            maxPolarAngle={Math.PI / 1.8} // Prevent going below floor
            minDistance={3}
            maxDistance={12}
            target={[0, 0, 0]}
        />

        <Suspense fallback={null}>
          <group position={[0, -0.5, 0]}>

            {/* Header - Floating Top HUD */}
            <Float speed={2} rotationIntensity={0.1} floatIntensity={0.2}>
              <Panel position={[0, 2.8, -1]} rotation={[0.1, 0, 0]} scale={0.8}>
                {header}
                <div className="absolute top-2 right-2">
                    <button
                        onClick={onExit}
                        className="px-4 py-2 bg-red-900/50 border border-red-500 text-red-200 rounded font-orbitron text-xs hover:bg-red-800 transition-colors"
                    >
                        EXIT 3D VIEW
                    </button>
                </div>
              </Panel>
            </Float>

            {/* Sequencer - Main Desk */}
            <Panel position={[0, 1.2, 0]} rotation={[-0.2, 0, 0]}>
              {sequencer}
            </Panel>

            {/* Keyboard - Lower Desk */}
            <Panel position={[0, 0.1, 0.8]} rotation={[-0.4, 0, 0]}>
              {keyboard}
            </Panel>

            {/* Hardware Rack - Bottom/Front */}
            <Panel position={[0, -1.2, 1.5]} rotation={[-0.6, 0, 0]}>
              {rack}
            </Panel>

          </group>

          {/* Floor Reflection */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]}>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.1} metalness={0.8} />
          </mesh>
          <ContactShadows position={[0, -3, 0]} opacity={0.6} scale={40} blur={2} far={4} />
        </Suspense>
      </Canvas>
    </div>
  );
};
