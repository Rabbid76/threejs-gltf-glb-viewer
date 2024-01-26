import type { QualityMap, QualityLevel } from '../renderer/scene-renderer';
import { QUALITY_LEVELS } from '../renderer/scene-renderer';
import { SHADOW_BLUR_TYPES } from '../renderer/pass/shadow-and-ao-pass';
import { AO_ALGORITHMS } from '../renderer/pass/ao-pass';

const noEffectsSuspension: Record<string, any> = {
  effectSuspendFrames: 0,
  effectFadeInFrames: 0,
  suspendGroundReflection: false,
  shadowOnCameraChange: SHADOW_BLUR_TYPES.FULL,
};

const partialEffectsSuspension: Record<string, any> = {
  effectSuspendFrames: 5,
  effectFadeInFrames: 5,
  suspendGroundReflection: false,
  shadowOnCameraChange: SHADOW_BLUR_TYPES.POISSON,
};

const fullEffectsSuspension: Record<string, any> = {
  effectSuspendFrames: 5,
  effectFadeInFrames: 5,
  suspendGroundReflection: true,
  shadowOnCameraChange: SHADOW_BLUR_TYPES.HARD,
};

const shAndAoPassParameters = {
  enabled: true,
  aoOnGround: true,
  shadowOnGround: true,
  aoIntensity: 1.0,
  shadowIntensity: 1.0,
  ao: {
    algorithm: AO_ALGORITHMS.GTAO,
    samples: 16,
    radius: 0.5,
    distanceExponent: 2,
    thickness: 1.0,
    distanceFallOff: 1.0,
    scale: 1,
    bias: 0.01,
    screenSpaceRadius: false,
  },
};

const screenSpaceShadowMapParameters = {
  enableGroundBoundary: false,
  directionalDependency: 1.0,
  directionalExponent: 1.0,
  groundBoundary: 0.0,
  fadeOutDistance: 0.2,
  fadeOutBlur: 5.0,
};

export const defaultQualityLevels: QualityMap = new Map<QualityLevel, any>([
  [
    QUALITY_LEVELS.HIGHEST,
    {
      ...noEffectsSuspension,
      shAndAoPassParameters,
      screenSpaceShadowMapParameters,
      groundReflectionParameters: {
        enabled: true,
      },
      bakedGroundContactShadowParameters: {
        enabled: false,
      },
    },
  ],
  [
    QUALITY_LEVELS.HIGH,
    {
      ...partialEffectsSuspension,
      shAndAoPassParameters,
      screenSpaceShadowMapParameters,
      groundReflectionParameters: {
        enabled: true,
      },
      bakedGroundContactShadowParameters: {
        enabled: false,
      },
    },
  ],
  [
    QUALITY_LEVELS.MEDIUM,
    {
      ...fullEffectsSuspension,
      shAndAoPassParameters,
      screenSpaceShadowMapParameters,
      groundReflectionParameters: {
        enabled: false,
      },
      bakedGroundContactShadowParameters: {
        enabled: false,
      },
    },
  ],
  [
    QUALITY_LEVELS.LOW,
    {
      shAndAoPassParameters: {
        enabled: false,
        aoOnGround: false,
        shadowOnGround: false,
      },
      groundReflectionParameters: {
        enabled: false,
      },
      bakedGroundContactShadowParameters: {
        enabled: true,
      },
    },
  ],
]);
