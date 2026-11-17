// Compatibility facade: the implementation lives in ./engineTelemetry/*.
// Each concern has exactly one owner module; callers may keep importing from here.

export * from './engineTelemetry/types';
export * from './engineTelemetry/capabilities';
export * from './engineTelemetry/report';
export * from './engineTelemetry/collector';
export * from './engineTelemetry/publicAsset';
export * from './engineTelemetry/exportMap';
export * from './engineTelemetry/fallbackReporting';
