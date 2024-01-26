import type { Enumify } from '../../utils/types';

export const NORMAL_VECTOR_SOURCE_TYPES = {
  INPUT_RGB_NORMAL: 'inputRgbNormal',
  FLOAT_BUFFER_NORMAL: 'floatBufferNormal',
  CONSTANT_Z: 'constantZ',
} as const;

export type NormalVectorSourceType = Enumify<typeof NORMAL_VECTOR_SOURCE_TYPES>;

export const DEPTH_VALUE_SOURCE_TYPES = {
  SEPARATE_BUFFER: 'separateBuffer',
  NORMAL_VECTOR_ALPHA: 'normalVectorAlpha',
} as const;

export type DepthValueSourceType = Enumify<typeof DEPTH_VALUE_SOURCE_TYPES>;
