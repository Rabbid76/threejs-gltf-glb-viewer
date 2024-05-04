import { AO_ALGORITHMS } from './pass/ao-pass';
import type { Enumify, Nullable } from '../utils/types';
import { deepMerge } from '../utils/common_utils';

export const SCENE_SHADING_TYPES = {
  DEFAULT: 'default',
  BRIGHT: 'bright',
} as const;

export type SceneShadingType = Enumify<typeof SCENE_SHADING_TYPES>;

export interface CustomShadingParameters {
  aoIntensity?: number;
  aoExtent?: number;
  shBakedOnGround?: boolean;
  shadowIntensity?: number;
  shadowSoftening?: number;
  grReflectIntensity?: number;
  grReflectFadeOut?: number;
}

const brightSceneShadingParameters: Record<string, any> = {
  shadowType: 'PCFSoftShadowMap',
  shAndAoPassParameters: {
    aoIntensity: 0.3,
    shadow: {
      shadowRadius: 0.1,
    },
    ao: {
      algorithm: AO_ALGORITHMS.SSAO,
      samples: 32,
      radius: 0.02,
      distanceExponent: 2,
      thickness: 0.1,
      distanceFallOff: 1,
      bias: 0.01,
    },
    poissonDenoise: {
      iterations: 2,
      samples: 16,
      radius: 5,
      radiusExponent: 1,
      lumaPhi: 10,
      depthPhi: 0.4,
      normalPhi: 4,
    },
  },
  groundReflectionParameters: {
    brightness: 0.5,
  },
};

type ObjectType = Record<string, object>;

export const mergeRendererParameters = (
  ...args: ObjectType[]
): Nullable<ObjectType> => {
  if (args.length === 0) {
    return null;
  }
  if (args.length === 1) {
    return args[0];
  }
  let target = args[0];
  for (let i = 1; i < args.length; i++) {
    target = deepMerge(target, args[i]);
  }
  return target;
};

export const getInteractionParameters = (
  uiInteractionMode: boolean
): Nullable<ObjectType> => {
  return uiInteractionMode
    ? {
        groundReflectionParameters: {
          enabled: false,
        },
      }
    : null;
};

export const getShadingParameters = (
  shadingType: SceneShadingType
): Nullable<ObjectType> => {
  if (!shadingType || shadingType === SCENE_SHADING_TYPES.DEFAULT) {
    return null;
  }
  if (shadingType === SCENE_SHADING_TYPES.BRIGHT) {
    return brightSceneShadingParameters;
  }
  return null;
};

const _clamp = (value: number): number => {
  return Math.max(0, Math.min(1, value));
};

interface ShadingMapParameters {
  shAndAoPassParameters: {
    aoIntensity?: number;
    shadowIntensity?: number;
    ao: {
      radius?: number;
      thickness?: number;
    };
    shadow: {
      shadowRadius?: number;
    };
  };
  groundReflectionParameters: {
    enabled?: boolean;
    intensity?: number;
    fadeOutDistance?: number;
  };
  bakedGroundContactShadowParameters: {
    enabled?: boolean;
    opacity?: number;
    blurMin?: number;
    blurMax?: number;
  };
}

export const mapCustomShadingParameters = (
  customShadingParameters: CustomShadingParameters
): Record<string, object> => {
  const parameters: ShadingMapParameters = {
    shAndAoPassParameters: {
      ao: {},
      shadow: {},
    },
    groundReflectionParameters: {},
    bakedGroundContactShadowParameters: {},
  };
  _mapCustomAoParameters(parameters, customShadingParameters);
  _mapCustomShadowParameters(parameters, customShadingParameters);
  _mapCustomGroundReflectionParameters(parameters, customShadingParameters);
  return parameters as unknown as Record<string, object>;
};

export const _mapCustomAoParameters = (
  parameters: ShadingMapParameters,
  customShadingParameters: CustomShadingParameters
) => {
  if (customShadingParameters.aoIntensity !== undefined) {
    parameters.shAndAoPassParameters.aoIntensity = _clamp(
      customShadingParameters.aoIntensity
    );
  }
  if (customShadingParameters.aoExtent !== undefined) {
    parameters.shAndAoPassParameters.ao.radius =
      _clamp(customShadingParameters.aoExtent) * 0.3;
    parameters.shAndAoPassParameters.ao.thickness =
      0.1 + _clamp(customShadingParameters.aoExtent) * 0.2;
  }
};

export const _mapCustomShadowParameters = (
  parameters: ShadingMapParameters,
  customShadingParameters: CustomShadingParameters
) => {
  if (customShadingParameters.shBakedOnGround) {
    parameters.bakedGroundContactShadowParameters.enabled = true;
    parameters.shAndAoPassParameters.shadowIntensity = 0;
    if (customShadingParameters.shadowIntensity !== undefined) {
      parameters.bakedGroundContactShadowParameters.opacity = _clamp(
        customShadingParameters.shadowIntensity
      );
    }
    if (customShadingParameters.shadowIntensity !== undefined) {
      parameters.bakedGroundContactShadowParameters.blurMax =
        _clamp(customShadingParameters.shadowIntensity) * 0.1;
      parameters.bakedGroundContactShadowParameters.blurMin =
        parameters.bakedGroundContactShadowParameters.blurMax * 0.01;
    }
  } else {
    if (customShadingParameters.shBakedOnGround !== undefined) {
      parameters.bakedGroundContactShadowParameters.enabled = false;
    }
    if (customShadingParameters.shadowIntensity !== undefined) {
      parameters.shAndAoPassParameters.shadowIntensity = _clamp(
        customShadingParameters.shadowIntensity
      );
    }
    if (customShadingParameters.shadowSoftening !== undefined) {
      parameters.shAndAoPassParameters.shadow.shadowRadius =
        0.001 + _clamp(customShadingParameters.shadowSoftening) * 0.2;
    }
  }
};

export const _mapCustomGroundReflectionParameters = (
  parameters: ShadingMapParameters,
  customShadingParameters: CustomShadingParameters
) => {
  if (customShadingParameters.grReflectIntensity !== undefined) {
    parameters.groundReflectionParameters.enabled =
      customShadingParameters.grReflectIntensity > 0;
    parameters.groundReflectionParameters.intensity = _clamp(
      customShadingParameters.grReflectIntensity
    );
  }
  if (customShadingParameters.grReflectFadeOut !== undefined) {
    parameters.groundReflectionParameters.fadeOutDistance =
      (1 - _clamp(customShadingParameters.grReflectFadeOut)) * 4;
  }
};
