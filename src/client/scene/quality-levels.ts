import type { QualityMap } from '../renderer/scene-renderer';
import { QualityLevel } from '../renderer/scene-renderer';
import { ShadowBlurType } from '../renderer/shadow-and-ao-pass';
import { AoAlgorithms } from '../renderer/pass/ao-pass';

const noEffectsSuspension: Record<string, any> = {
  effectSuspendFrames: 0,
  effectFadeInFrames: 0,
  suspendGroundReflection: false,
  shadowOnCameraChange: ShadowBlurType.FULL,
};

const partialEffectsSuspension: Record<string, any> = {
  effectSuspendFrames: 5,
  effectFadeInFrames: 5,
  suspendGroundReflection: false,
  shadowOnCameraChange: ShadowBlurType.POISSON,
};

const fullEffectsSuspension: Record<string, any> = {
  effectSuspendFrames: 5,
  effectFadeInFrames: 5,
  suspendGroundReflection: true,
  shadowOnCameraChange: ShadowBlurType.HARD,
};

const shAndAoPassParameters = {
  enabled: true,
  aoOnGround: true,
  shadowOnGround: true,
  aoIntensity: 1.0,
  shadowIntensity: 1.0,
  ao: {
    algorithm: AoAlgorithms.GTAO,
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
    QualityLevel.HIGHEST,
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
    QualityLevel.HIGH,
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
    QualityLevel.MEDIUM,
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
    QualityLevel.LOW,
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
