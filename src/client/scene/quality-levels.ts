import type { QualityMap } from '../renderer/scene-renderer';
import { QualityLevel } from '../renderer/scene-renderer';
import {
  AmbientOcclusionType,
  ShadowBlurType,
} from '../renderer/shadow-and-ao-pass';

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

export const defaultQualityLevels: QualityMap = new Map<
  QualityLevel,
  any
>([
  [
    QualityLevel.HIGHEST,
    {
      ...noEffectsSuspension,
      shAndAoPassParameters: {
        enabled: true,
        aoType: AmbientOcclusionType.SSAO,
        aoOnGround: true,
        shadowOnGround: true,
        aoIntensity: 0.7,
        shadowIntensity: 0.5,
      },
      screenSpaceShadowMapParameters: {
        directionalDependency: 1.0,
        fadeOutDistance: 2.0,
      },
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
      shAndAoPassParameters: {
        enabled: true,
        aoType: AmbientOcclusionType.SSAO,
        aoOnGround: true,
        shadowOnGround: true,
        aoIntensity: 0.7,
        shadowIntensity: 0.5,
      },
      screenSpaceShadowMapParameters: {
        directionalDependency: 1.0,
        fadeOutDistance: 2.0,
      },
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
      shAndAoPassParameters: {
        enabled: true,
        aoType: AmbientOcclusionType.SSAO,
        aoOnGround: true,
        shadowOnGround: true,
        aoIntensity: 0.7,
        shadowIntensity: 0.5,
      },
      screenSpaceShadowMapParameters: {
        directionalDependency: 1.0,
        fadeOutDistance: 2.0,
      },
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

