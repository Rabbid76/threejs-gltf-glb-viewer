import type { Texture } from 'three';
import { Matrix4, Vector2 } from 'three';

export const generatePdSamplePointInitializer = (
  samples: number,
  rings: number
) => {
  const poissonDisk = generateDenoiseSamples(samples, rings);
  let glslCode = 'vec3[SAMPLES](';
  for (let i = 0; i < samples; i++) {
    const sample = poissonDisk[i];
    const length = sample.length();
    sample.normalize();
    glslCode += `vec3(${sample.x}, ${sample.y}, ${length})`;
    if (i < samples - 1) {
      glslCode += ',';
    }
  }
  glslCode += ')';
  return glslCode;
};

export const generateDenoiseSamples = (
  numSamples: number,
  numRings: number
) => {
  const angleStep = (2 * Math.PI * numRings) / numSamples;
  const invNumSamples = 1.0 / numSamples;
  const radiusStep = invNumSamples;
  const samples = [];
  let radius = invNumSamples;
  let angle = 0;
  for (let i = 0; i < numSamples; i++) {
    const v = new Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(
      Math.pow(radius, 0.75)
    );
    samples.push(v);
    radius += radiusStep;
    angle += angleStep;
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
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float radius;
uniform float radiusExponent;
uniform int index;

#include <common>
#include <packing>

#define VIEW_SPACE_RADIUS_SCALE 0.001

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

void denoiseSample(in vec3 center, in vec3 viewNormal, in vec3 viewPos, in vec2 sampleUv, inout vec3 denoised, inout vec3 totalWeight) {
    vec4 sampleTexel = textureLod(tDiffuse, sampleUv, 0.0);
    float sampleDepth = getDepth(sampleUv);
    vec3 sampleNormal = getViewNormal(sampleUv);
    vec3 neighborColor = sampleTexel.rgb;
    vec3 viewPosSample = getViewPosition(sampleUv, sampleDepth);
    
    float normalDiff = dot(viewNormal, sampleNormal);
    float normalSimilarity = pow(max(normalDiff, 0.), normalPhi);
    vec3 lumaDiff = abs(neighborColor.rgb - center.rgb);
    vec3 lumaSimilarity = max(1. - lumaDiff / lumaPhi, 0.);
    float depthDiff = abs(dot(viewPos - viewPosSample, viewNormal));
    float depthSimilarity = max(1. - depthDiff / depthPhi, 0.);
    vec3 w = lumaSimilarity * depthSimilarity * normalSimilarity;

    denoised += w * neighborColor;
    totalWeight += w;
}

void main() {
    float depth = getDepth(vUv.xy);	
    vec3 viewNormal = getViewNormal(vUv);	
    if (depth == 1. || dot(viewNormal, viewNormal) == 0.) {
        discard;
        return;
    }
    vec4 texel = textureLod(tDiffuse, vUv, 0.0);
    vec3 center = texel.rgb;
    vec3 viewPos = getViewPosition(vUv, depth);

    vec2 noiseResolution = vec2(textureSize(tNoise, 0));
    vec2 noiseUv = vUv * resolution / noiseResolution;
    vec4 noiseTexel = textureLod(tNoise, noiseUv, 0.0);
    //vec2 noiseVec = normalize((index % 2 == 0 ? noiseTexel.xy : noiseTexel.yz) * 2.0 - 1.0);
    vec2 noiseVec = vec2(sin(noiseTexel[index % 4] * 2. * PI), cos(noiseTexel[index % 4] * 2. * PI));
    mat2 rotationMatrix = mat2(noiseVec.x, -noiseVec.y, noiseVec.x, noiseVec.y);

    vec3 totalWeight = vec3(1.0);
    vec3 denoised = texel.rgb;

#if ADD_ADJACENT_SAMPLES == 1
    denoiseSample(center, viewNormal, viewPos, vUv + vec2(1./resolution.x, 0.), denoised, totalWeight);
    denoiseSample(center, viewNormal, viewPos, vUv + vec2(-1./resolution.x, 0.), denoised, totalWeight);
    denoiseSample(center, viewNormal, viewPos, vUv + vec2(0., 1./resolution.y), denoised, totalWeight);
    denoiseSample(center, viewNormal, viewPos, vUv + vec2(0., -1./resolution.y), denoised, totalWeight);
#endif

    for (int i = 0; i < SAMPLES; ++i) {
        vec3 direction = poissonDisk[i];
    #if SCREEN_SPACE_RADIUS == 1
        vec2 offset = rotationMatrix * direction.xy * max(vec2(1.), pow(direction.z, radiusExponent) * radius) / resolution;
        vec2 sampleUv = vUv + offset;
    #else
        vec3 offsetViewPos = viewPos + vec3(direction.xy, 0.) * pow(direction.z, radiusExponent) * radius * VIEW_SPACE_RADIUS_SCALE;
        vec4 samplePointNDC = cameraProjectionMatrix * vec4(offsetViewPos, 1.0); 
        vec2 sampleUv = samplePointNDC.xy / samplePointNDC.w * 0.5 + 0.5;
    #endif
        denoiseSample(center, viewNormal, viewPos, sampleUv, denoised, totalWeight);
    }

    denoised /= totalWeight + 1.0 - step(0.0, totalWeight);
    gl_FragColor = vec4(denoised, 1.);
}`;

export const poissonDenoiseShader = {
  name: 'PoissonDenoiseShader',
  defines: {
    SAMPLES: 12,
    SAMPLE_VECTORS: generatePdSamplePointInitializer(12, 4),
    ADD_ADJACENT_SAMPLES: 1,
    SCREEN_SPACE_RADIUS: 1,
    NORMAL_VECTOR_TYPE: 1,
    DEPTH_VALUE_SOURCE: 0,
  },
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    tNormal: { value: null as Texture | null },
    tDepth: { value: null as Texture | null },
    tNoise: { value: null as Texture | null },
    resolution: { value: new Vector2() },
    cameraProjectionMatrix: { value: new Matrix4() },
    cameraProjectionMatrixInverse: { value: new Matrix4() },
    lumaPhi: { value: 5 },
    depthPhi: { value: 5 },
    normalPhi: { value: 5 },
    radius: { value: 10 },
    radiusExponent: { value: 1 },
    index: { value: 0 },
  },
  vertexShader: poissonDenoiseVertexShader,
  fragmentShader: poissonDenoiseFragmentShader,
};
