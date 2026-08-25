/**
 * Types for the shipped community package. Sits beside index.js so TypeScript
 * can resolve it through a normal import, and so the host ABI a community
 * package must satisfy is written down somewhere executable.
 *
 * Not bundled — public/ is copied verbatim; this file only exists for the
 * type-checker and for anyone writing another package.
 */
import type { Wam2CommunityModule } from '../../../../src/audio/wam/installer';
import type { Wam2PackageDescriptor, Wam2Plugin } from '../../../../src/audio/wam/types';

export declare const wam2ApiVersion: 1;
export declare function createWam2Plugin(descriptor: Wam2PackageDescriptor): Wam2Plugin;

export type { Wam2CommunityModule };
