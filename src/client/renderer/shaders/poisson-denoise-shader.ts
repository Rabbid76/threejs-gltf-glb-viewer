import type { Texture } from 'three';
import { Matrix4, Vector3, Vector2 } from 'three';

export const generatePdSamplePointInitializer = (
  samples: number,
  rings: number,
  radius: number,
  radiusExponent: number
) => {
  const poissonDisk = generateDenoiseSamples(
    samples,
    rings,
    radius,
    radiusExponent
  );
  let glslCode = 'vec3[SAMPLES](';
  for (let i = 0; i < samples; i++) {
    const sample = poissonDisk[i];
    glslCode += `vec3(${sample.x}, ${sample.y}, ${sample.z})${
      i < samples - 1 ? ',' : ')'
    }`;
  }
  return glslCode;
};

export const generateDenoiseSamples = (
  numSamples: number,
  numRings: number,
  radius: number,
  radiusExponent: number
) => {
  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const angle = (2 * Math.PI * numRings * i) / numSamples;
    const relativeRadius =
      (1 + (radius - 1) * Math.pow(i / (numSamples - 1), radiusExponent)) /
      radius;
    samples.push(new Vector3(Math.cos(angle), Math.sin(angle), relativeRadius));
  }
  return samples;
};

const poissonDenoiseVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const poissonDenoiseFragmentShader = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tNoise;
uniform vec2 resolution;
uniform mat4 cameraProjectionMatrix;
uniform mat4 cameraProjectionMatrixInverse;
uniform mat4 cameraWorldMatrix;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float radius;
uniform float radiusExponent;
uniform int iteration;
uniform int noOfIterations;
#if SCENE_CLIP_BOX == 1
    uniform vec3 sceneBoxMin;
    uniform vec3 sceneBoxMax;
#endif

#include <common>
#include <packing>

#if LUMINANCE_WEIGHTED == 1  

#ifndef LUMINANCE_TYPE
#define LUMINANCE_TYPE float
#endif
#ifndef SAMPLE_LUMINANCE
#define SAMPLE_LUMINANCE dot(vec3(0.2125, 0.7154, 0.0721), a)
#endif
#define WEIGHT_TYPE LUMINANCE_TYPE

#else
#define WEIGHT_TYPE float
#endif

#ifndef FRAGMENT_OUTPUT
#define FRAGMENT_OUTPUT vec4(vec3(denoised), 1.)
#endif

LUMINANCE_TYPE getLuminance(const in vec3 a) {
    return SAMPLE_LUMINANCE;
}

const vec3 poissonDisk[SAMPLES] = SAMPLE_VECTORS;

vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
    vec4 clipSpacePosition = vec4(vec3(screenPosition, depth) * 2.0 - 1.0, 1.0);
    vec4 viewSpacePosition = cameraProjectionMatrixInverse * clipSpacePosition;
    return viewSpacePosition.xyz / viewSpacePosition.w;
}

float getDepth(const vec2 uv) {
#if DEPTH_VALUE_SOURCE == 1    
    return textureLod(tDepth, uv.xy, 0.0).a;
#else
    return textureLod(tDepth, uv.xy, 0.0).r;
#endif
}

float fetchDepth(const ivec2 uv) {
#if DEPTH_VALUE_SOURCE == 1    
    return texelFetch(tDepth, uv.xy, 0).a;
#else
    return texelFetch(tDepth, uv.xy, 0).r;
#endif
}

vec3 computeNormalFromDepth(const vec2 uv) {
    vec2 size = vec2(textureSize(tDepth, 0));
    ivec2 p = ivec2(uv * size);
    float c0 = fetchDepth(p);
    float l2 = fetchDepth(p - ivec2(2, 0));
    float l1 = fetchDepth(p - ivec2(1, 0));
    float r1 = fetchDepth(p + ivec2(1, 0));
    float r2 = fetchDepth(p + ivec2(2, 0));
    float b2 = fetchDepth(p - ivec2(0, 2));
    float b1 = fetchDepth(p - ivec2(0, 1));
    float t1 = fetchDepth(p + ivec2(0, 1));
    float t2 = fetchDepth(p + ivec2(0, 2));
    float dl = abs((2.0 * l1 - l2) - c0);
    float dr = abs((2.0 * r1 - r2) - c0);
    float db = abs((2.0 * b1 - b2) - c0);
    float dt = abs((2.0 * t1 - t2) - c0);
    vec3 ce = getViewPosition(uv, c0).xyz;
    vec3 dpdx = (dl < dr) ?  ce - getViewPosition((uv - vec2(1.0 / size.x, 0.0)), l1).xyz
                : -ce + getViewPosition((uv + vec2(1.0 / size.x, 0.0)), r1).xyz;
    vec3 dpdy = (db < dt) ?  ce - getViewPosition((uv - vec2(0.0, 1.0 / size.y)), b1).xyz
                : -ce + getViewPosition((uv + vec2(0.0, 1.0 / size.y)), t1).xyz;
    return normalize(cross(dpdx, dpdy));
}

vec3 getViewNormal(const vec2 uv) {
#if NORMAL_VECTOR_TYPE == 2
    return normalize(textureLod(tNormal, uv, 0.).rgb);
#elif NORMAL_VECTOR_TYPE == 1
    return unpackRGBToNormal(textureLod(tNormal, uv, 0.).rgb);
#else
    return computeNormalFromDepth(uv);
#endif
}

void denoiseSample(in vec3 center, in vec3 viewNormal, in vec3 viewPos, in vec2 sampleUv, inout vec3 denoised, inout WEIGHT_TYPE totalWeight) {
    vec4 sampleTexel = textureLod(tDiffuse, sampleUv, 0.0);
    float sampleDepth = getDepth(sampleUv);
    vec3 sampleNormal = getViewNormal(sampleUv);
    vec3 neighborColor = sampleTexel.rgb;
    vec3 viewPosSample = getViewPosition(sampleUv, sampleDepth);
    
    float normalDiff = dot(viewNormal, sampleNormal);
    float normalSimilarity = pow(max(normalDiff, 0.), normalPhi);
    float depthDiff = abs(dot(normalize(viewPos - viewPosSample), viewNormal));
    float depthSimilarity = max(1. - depthDiff / depthPhi, 0.);
    #if LUMINANCE_WEIGHTED == 1  
      LUMINANCE_TYPE lumaDiff = abs(getLuminance(neighborColor) - getLuminance(center));
      LUMINANCE_TYPE lumaSimilarity = max(1. - lumaDiff / lumaPhi, 0.);
      LUMINANCE_TYPE w = lumaSimilarity * depthSimilarity * normalSimilarity;
    #else
      WEIGHT_TYPE w = depthSimilarity * normalSimilarity;
    #endif

    denoised += w * neighborColor;
    totalWeight += w;
}

void main() {
    float depth = fetchDepth(ivec2(vec2(textureSize(tDepth, 0)) * vUv.xy));	
    vec3 viewNormal = getViewNormal(vUv);	
    if (depth == 1. || dot(viewNormal, viewNormal) == 0.) {
        discard;
        return;
    }
    vec4 texel = textureLod(tDiffuse, vUv, 0.0);
    vec3 center = texel.rgb;
    vec3 viewPos = getViewPosition(vUv, depth);

    #if SCENE_CLIP_BOX == 1
      vec3 worldPos = (cameraWorldMatrix * vec4(viewPos, 1.0)).xyz;
          float boxDistance = length(max(vec3(0.0), max(sceneBoxMin - worldPos, worldPos - sceneBoxMax)));
      if (boxDistance > radius * 2.) {
        discard;
        return;
      }
		#endif

    vec2 noiseResolution = vec2(textureSize(tNoise, 0));
    vec2 noiseUv = vUv * resolution / noiseResolution;
    vec4 noiseTexel = textureLod(tNoise, noiseUv, 0.0);
    vec2 noiseVec = vec2(sin(noiseTexel[iteration % 4] * 2. * PI), cos(noiseTexel[iteration % 4] * 2. * PI));
    #if SAMPLE_DISTRIBUTION == 1
      vec3 randomVec = normalize(vec3(noiseVec.xy, 0.));
      vec3 tangent = normalize(randomVec - viewNormal * dot(randomVec, viewNormal));
      vec3 bitangent = cross(viewNormal, tangent);
      mat3 kernelMatrix = mat3(tangent, bitangent, viewNormal);
    #else
      mat2 rotationMatrix = mat2(noiseVec.x, -noiseVec.y, noiseVec.x, noiseVec.y);
    #endif

    WEIGHT_TYPE totalWeight = WEIGHT_TYPE(1.);
    vec3 denoised = texel.rgb;
    for (int i = 0; i < SAMPLES; i++) {
        vec3 sampleDir = poissonDisk[i];
    #if SAMPLE_DISTRIBUTION == 1
        vec3 offsetViewPos = viewPos + normalize(kernelMatrix * vec3(sampleDir.xy, 0.)) * sampleDir.z * radius * radius;
        vec4 samplePointNDC = cameraProjectionMatrix * vec4(offsetViewPos, 1.0); 
        vec2 sampleUv = (samplePointNDC.xy / samplePointNDC.w * 0.5 + 0.5);
    #else
        vec2 offset = rotationMatrix * sampleDir.xy * (1. + sampleDir.z * (radius - 1.));
        offset *= mix(vec2(1.0), sqrt(1.0 - viewNormal.xy * viewNormal.xy), float(iteration) / float(noOfIterations-1));
        offset *= max(1.0, 1.0 / length(offset));
        vec2 sampleUv = vUv + offset / resolution;
    #endif
        denoiseSample(center, viewNormal, viewPos, sampleUv, denoised, totalWeight);
    }

    denoised /= totalWeight + 1.0 - step(0.0, totalWeight);
    gl_FragColor = FRAGMENT_OUTPUT;
}`;

export const poissonDenoiseShader = {
  name: 'PoissonDenoiseShader',
  defines: {
    SAMPLES: 16,
    SAMPLE_VECTORS: generatePdSamplePointInitializer(16, 2.89, 4, 1.3),
    NV_ALIGNED_SAMPLES: 0,
    SAMPLE_DISTRIBUTION: 0,
    DEPTH_VALUE_SOURCE: 0,
    LUMINANCE_WEIGHTED: 1,
    LUMINANCE_TYPE: 'float',
    SAMPLE_LUMINANCE: 'dot(vec3(0.2125, 0.7154, 0.0721), a)',
    SCENE_CLIP_BOX: 0,
    FRAGMENT_OUTPUT: 'vec4(vec3(denoised), 1.)',
  },
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    tNormal: { value: null as Texture | null },
    tDepth: { value: null as Texture | null },
    tNoise: { value: null as Texture | null },
    resolution: { value: new Vector2() },
    cameraProjectionMatrix: { value: new Matrix4() },
    cameraProjectionMatrixInverse: { value: new Matrix4() },
    cameraWorldMatrix: { value: new Matrix4() },
    lumaPhi: { value: 5 },
    depthPhi: { value: 1 },
    normalPhi: { value: 1 },
    radius: { value: 10 },
    radiusExponent: { value: 1.3 },
    iteration: { value: 0 },
    noOfIterations: { value: 2 },
    sceneBoxMin: { value: new Vector3(-1, -1, -1) },
    sceneBoxMax: { value: new Vector3(1, 1, 1) },
  },
  vertexShader: poissonDenoiseVertexShader,
  fragmentShader: poissonDenoiseFragmentShader,
};
