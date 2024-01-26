import { AO_ALGORITHMS } from './pass/ao-pass';
import type { Enumify, Nullable } from '../utils/types';
import { deepMerge } from '../utils/common_utils';

export const SCENE_SHADING_TYPES = {
  DEFAULT: 'default',
  BRIGHT: 'bright',
} as const;

export type SceneShadingType = Enumify<typeof SCENE_SHADING_TYPES>;

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
