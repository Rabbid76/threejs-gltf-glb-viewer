import { Matrix4, Vector2, Vector3, Vector4 } from 'three';

type Enumify<T> = T[keyof T];

export const AoAlgorithms = {
  SSAO: 0,
  SAO: 1,
  N8AO: 2,
  HBAO: 3,
  GTAO: 4,
} as const;

export type AoAlgorithmType = Enumify<typeof AoAlgorithms> | null;

export const generateAoSampleKernelInitializer = (
  samples: number,
  cosineWeighted: boolean
) => {
  const poissonDisk = generateAoSamples(samples, cosineWeighted);
  let glslCode = 'vec4[SAMPLES](';
  for (let i = 0; i < samples; i++) {
    const sample = poissonDisk[i];
    glslCode += `vec4(${sample.x}, ${sample.y}, ${sample.z}, ${sample.w})${
      i < samples - 1 ? ',' : ')'
    }`;
  }
  return glslCode;
};

const generateAoSamples = (samples: number, cosineWeighted: boolean) => {
  // https://github.com/Rabbid76/research-sampling-hemisphere
  const kernel = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    const spiralAngle = sampleIndex * Math.PI * (3 - Math.sqrt(5));
    let z = 0.01 + (sampleIndex / (samples - 1)) * 0.99;
    const radius = cosineWeighted ? Math.sqrt(1 - z * z) : 1 - z;
    const x = Math.cos(spiralAngle) * radius;
    const y = Math.sin(spiralAngle) * radius;
    const scaleStep = 4;
    const scaleRange = Math.floor(samples / scaleStep);
    const scaleIndex =
      Math.floor(sampleIndex / scaleStep) +
      (sampleIndex % scaleStep) * scaleRange;
    let scale = 1 - scaleIndex / samples;
    scale = 0.1 + 0.9 * scale;
    kernel.push(new Vector4(x, y, z, scale));
  }

  return kernel;
};

export const AOShader = {
  name: 'AOShader',

  defines: {
    PERSPECTIVE_CAMERA: 1,
    SAMPLES: 16,
    SAMPLE_VECTORS: generateAoSampleKernelInitializer(16, false),
    NORMAL_VECTOR_TYPE: 1,
    DEPTH_SWIZZLING: 'x',
    AO_ALGORITHM: AoAlgorithms.GTAO,
    NV_ALIGNED_SAMPLES: 1,
    SCREEN_SPACE_RADIUS: 0,
    SCREEN_SPACE_RADIUS_SCALE: 100.0,
    SCENE_CLIP_BOX: 0,
    NORMAL_VECTOR_ANTIALIAS: 2,
    DEPTH_BUFFER_ANTIALIAS: 1,
  },

  uniforms: {
    tNormal: { value: null },
    tDepth: { value: null },
    tNoise: { value: null },
    resolution: { value: new Vector2() },
    cameraNear: { value: null },
    cameraFar: { value: null },
    cameraProjectionMatrix: { value: new Matrix4() },
    cameraProjectionMatrixInverse: { value: new Matrix4() },
    cameraWorldMatrix: { value: new Matrix4() },
    radius: { value: 1 },
    distanceExponent: { value: 1 },
    thickness: { value: 1 },
    distanceFallOff: { value: 1 },
    bias: { value: 0.001 },
    scale: { value: 1 },
    sceneBoxMin: { value: new Vector3(-1, -1, -1) },
    sceneBoxMax: { value: new Vector3(1, 1, 1) },
  },

  vertexShader: /* glsl */ `

		varying vec2 vUv;

		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

  fragmentShader: /* glsl */ `

		varying vec2 vUv;
		uniform highp sampler2D tNormal;
		uniform highp sampler2D tDepth;
		uniform sampler2D tNoise;
		uniform vec2 resolution;
		uniform float cameraNear;
		uniform float cameraFar;
		uniform mat4 cameraProjectionMatrix;
		uniform mat4 cameraProjectionMatrixInverse;		
		uniform mat4 cameraWorldMatrix;
		uniform float radius;
		uniform float distanceExponent;
		uniform float thickness;
		uniform float distanceFallOff;
		uniform float bias;
		uniform float scale;
		#if SCENE_CLIP_BOX == 1
			uniform vec3 sceneBoxMin;
			uniform vec3 sceneBoxMax;
		#endif
		
		#include <common>
		#include <packing>

		#ifndef FRAGMENT_OUTPUT
		#define FRAGMENT_OUTPUT vec4(vec3(ao), 1.)
		#endif

		const vec4 sampleKernel[SAMPLES] = SAMPLE_VECTORS;

		vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
			vec4 clipSpacePosition = vec4(vec3(screenPosition, depth) * 2.0 - 1.0, 1.0);
			vec4 viewSpacePosition = cameraProjectionMatrixInverse * clipSpacePosition;
			return viewSpacePosition.xyz / viewSpacePosition.w;
		}

		float getDepth(const vec2 uv) {  
			#if DEPTH_BUFFER_ANTIALIAS == 1
				vec2 size = vec2(textureSize(tDepth, 0));
				ivec2 p = ivec2(uv * size);
				float d0 = texelFetch(tDepth, p, 0).DEPTH_SWIZZLING;
				vec2 depth = vec2(d0, 1.0);
				float d1 = texelFetch(tDepth, p + ivec2(1, 0), 0).DEPTH_SWIZZLING;
				depth += vec2(d1, 1.0) * step(abs(d1 - d0), 0.1);
				float d2 = texelFetch(tDepth, p - ivec2(1, 0), 0).DEPTH_SWIZZLING;
				depth += vec2(d2, 1.0) * step(abs(d2 - d0), 0.1);
				float d3 = texelFetch(tDepth, p + ivec2(0, 1), 0).DEPTH_SWIZZLING;
				depth += vec2(d3, 1.0) * step(abs(d3 - d0), 0.1);
				float d4 = texelFetch(tDepth, p - ivec2(0, 1), 0).DEPTH_SWIZZLING;
				depth += vec2(d4, 1.0) * step(abs(d4 - d0), 0.1);
				return depth.x / depth.y;
          	#else
              	return textureLod(tDepth, uv.xy, 0.0).DEPTH_SWIZZLING;
          	#endif
		}

		float fetchDepth(const ivec2 uv) {   
			return texelFetch(tDepth, uv.xy, 0).DEPTH_SWIZZLING;
		}

		float getViewZ(const in float depth) {
			#if PERSPECTIVE_CAMERA == 1
				return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
			#else
				return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
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

		vec3 getAntiAliasedViewNormal(const in vec2 screenPosition) {
			#if NORMAL_VECTOR_TYPE == 2
				#if NORMAL_VECTOR_ANTIALIAS == 1
					vec2 uv = screenPosition;
					vec2 size = vec2(textureSize(tNormal, 0));
					ivec2 p = ivec2(screenPosition * size);
					float c0 = texelFetch(tNormal, p, 0).a;
					float l2 = texelFetch(tNormal, p - ivec2(2, 0), 0).a;
					float l1 = texelFetch(tNormal, p - ivec2(1, 0), 0).a;
					float r1 = texelFetch(tNormal, p + ivec2(1, 0), 0).a;
					float r2 = texelFetch(tNormal, p + ivec2(2, 0), 0).a;
					float b2 = texelFetch(tNormal, p - ivec2(0, 2), 0).a;
					float b1 = texelFetch(tNormal, p - ivec2(0, 1), 0).a;
					float t1 = texelFetch(tNormal, p + ivec2(0, 1), 0).a;
					float t2 = texelFetch(tNormal, p + ivec2(0, 2), 0).a;
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
				#elif NORMAL_VECTOR_ANTIALIAS == 2
					vec2 size = vec2(textureSize(tNormal, 0));
					ivec2 p = ivec2(screenPosition * size);
					vec3 normalVector = texelFetch(tNormal, p, 0).xyz;
					normalVector += texelFetch(tNormal, p + ivec2(1, 0), 0).xyz;
					normalVector += texelFetch(tNormal, p - ivec2(1, 0), 0).xyz;
					normalVector += texelFetch(tNormal, p + ivec2(0, 1), 0).xyz;
					normalVector += texelFetch(tNormal, p - ivec2(0, 1), 0).xyz;
					return normalize(normalVector);
				#else
					return texture2D(tNormal, screenPosition).xyz;
				#endif
			#elif NORMAL_VECTOR_TYPE == 1
				return unpackRGBToNormal(textureLod(tNormal, screenPosition, 0.).rgb);
			#else
				return computeNormalFromDepth(screenPosition);
			#endif
		  }

		vec3 getSceneUvAndDepth(vec3 sampleViewPos) {
			vec4 sampleClipPos = cameraProjectionMatrix * vec4(sampleViewPos, 1.);
			vec2 sampleUv = sampleClipPos.xy / sampleClipPos.w * 0.5 + 0.5;
			float sampleSceneDepth = getDepth(sampleUv);
			return vec3(sampleUv, sampleSceneDepth);
		}

		float sinusToPlane(vec3 pointOnPlane, vec3 planeNormal, vec3 point) {
			vec3 delta = point - pointOnPlane;
			float sinV = dot(planeNormal, normalize(delta));
			return sinV;
		}

		float getFallOff(float delta, float falloffDistance) {
			float fallOff = smoothstep(0., 1., 1. - distanceFallOff * abs(delta) / falloffDistance);
			return fallOff;
		}
		
		void main() {
			float depth = getDepth(vUv.xy);
			if (depth >= 1.0) {
				discard;
				return;
			}
			vec3 viewPos = getViewPosition(vUv, depth);
			vec3 viewNormal = getAntiAliasedViewNormal(vUv);

			float radiusToUse = radius;
			float distanceFalloffToUse = thickness;
			#if SCREEN_SPACE_RADIUS == 1
			    float radiusScale = getViewPosition(vec2(0.5 + float(SCREEN_SPACE_RADIUS_SCALE) / resolution.x, 0.0), depth).x;
				radiusToUse *= radiusScale;
				distanceFalloffToUse *= radiusScale;
			#endif

			#if SCENE_CLIP_BOX == 1
				vec3 worldPos = (cameraWorldMatrix * vec4(viewPos, 1.0)).xyz;
      			float boxDistance = length(max(vec3(0.0), max(sceneBoxMin - worldPos, worldPos - sceneBoxMax)));
				if (boxDistance > radiusToUse) {
					discard;
					return;
				}
			#endif
			
			vec2 noiseResolution = vec2(textureSize(tNoise, 0));
			vec2 noiseUv = vUv * resolution / noiseResolution;
			vec4 noiseTexel = textureLod(tNoise, noiseUv, 0.0);
			vec3 randomVec = noiseTexel.xyz * 2.0 - 1.0;

			#if NV_ALIGNED_SAMPLES == 1
  				vec3 tangent = normalize(randomVec - viewNormal * dot(randomVec, viewNormal));
      			vec3 bitangent = cross(viewNormal, tangent);
      			mat3 kernelMatrix = mat3(tangent, bitangent, viewNormal);
			#else
				vec3 tangent = normalize(vec3(randomVec.xy, 0.));
				vec3 bitangent = vec3(-tangent.y, tangent.x, 0.);
				mat3 kernelMatrix = mat3(tangent, bitangent, vec3(0., 0., 1.));
			#endif

		#if AO_ALGORITHM == 4
			const int DIRECTIONS = SAMPLES < 30 ? 3 : 5;
			const int STEPS = (SAMPLES + DIRECTIONS - 1) / DIRECTIONS;
		#elif AO_ALGORITHM == 3
			const int DIRECTIONS = SAMPLES < 16 ? 3 : 5;
			const int STEPS = (SAMPLES + DIRECTIONS - 1) / DIRECTIONS;
		#else
			const int DIRECTIONS = SAMPLES;
			const int STEPS = 1;
		#endif

			float ao = 0.0, totalWeight = 0.0;
			for (int i = 0; i < DIRECTIONS; ++i) {

			#if AO_ALGORITHM == 4
				float angle = float(i) / float(DIRECTIONS) * PI;
				vec4 sampleDir = vec4(cos(angle), sin(angle), 0., 0.5 + 0.5 * noiseTexel.w); 
			#elif AO_ALGORITHM == 3
				float angle = float(i) / float(DIRECTIONS) * 2. * PI;
				vec4 sampleDir = vec4(cos(angle), sin(angle), 0., 0.5 + 0.5 * noiseTexel.w); 
			#else
				vec4 sampleDir = sampleKernel[i];
			#endif
				sampleDir.xyz = normalize(kernelMatrix * sampleDir.xyz);

				vec3 viewDir = normalize(-viewPos.xyz);
				vec3 sliceBitangent = normalize(cross(sampleDir.xyz, viewDir));
				vec3 sliceTangent = cross(sliceBitangent, viewDir);
				vec3 normalInSlice = normalize(viewNormal - sliceBitangent * dot(viewNormal, sliceBitangent));
				
			#if (AO_ALGORITHM == 3 || AO_ALGORITHM == 4)
				vec3 tangentToNormalInSlice = cross(normalInSlice, sliceBitangent);
				#if AO_ALGORITHM == 4
					vec2 cosHorizons = vec2(dot(viewDir, tangentToNormalInSlice), dot(viewDir, -tangentToNormalInSlice));
				#else
					vec2 cosHorizons = vec2(dot(viewDir, tangentToNormalInSlice));
				#endif
				for (int j = 0; j < STEPS; ++j) {
					vec3 sampleViewOffset = sampleDir.xyz * radiusToUse * sampleDir.w * pow(float(j + 1) / float(STEPS), distanceExponent);
					vec3 sampleViewPos = viewPos + sampleViewOffset;
			#else
					vec3 sampleViewPos = viewPos + sampleDir.xyz * radiusToUse * pow(sampleDir.w, distanceExponent);
			#endif	

					vec3 sampleSceneUvDepth = getSceneUvAndDepth(sampleViewPos);
					vec3 sampleSceneViewPos = getViewPosition(sampleSceneUvDepth.xy, sampleSceneUvDepth.z);
					float sceneSampleDist = abs(sampleSceneViewPos.z);
					float sampleDist = abs(sampleViewPos.z);
					
				#if (AO_ALGORITHM == 3 || AO_ALGORITHM == 4)
					// HBAO || GTAO
					vec3 viewDelta = sampleSceneViewPos - viewPos;
					if (abs(viewDelta.z) < thickness) {
						float sampleCosHorizon = dot(viewDir, normalize(viewDelta));
						cosHorizons.x += max(0., (sampleCosHorizon - cosHorizons.x) * mix(1., 2. / float(j + 2), distanceFallOff));
					}		
					#if AO_ALGORITHM == 4
						sampleSceneUvDepth = getSceneUvAndDepth(viewPos - sampleViewOffset);
						sampleSceneViewPos = getViewPosition(sampleSceneUvDepth.xy, sampleSceneUvDepth.z);
						viewDelta = sampleSceneViewPos - viewPos;
						if (abs(viewDelta.z) < thickness) {
							float sampleCosHorizon = dot(viewDir, normalize(viewDelta));
							cosHorizons.y += max(0., (sampleCosHorizon - cosHorizons.y) * mix(1., 2. / float(j + 2), distanceFallOff));	
						}
					#endif
				#elif AO_ALGORITHM == 2
					// N8AO
					float weight = dot(viewNormal, sampleDir.xyz);
					float occlusion = weight * step(sceneSampleDist + bias, sampleDist);
				#elif AO_ALGORITHM == 1
					// SAO
					vec3 viewDelta = sampleSceneViewPos - viewPos;
					float minResolution = 0.; // ?
					float scaledViewDist = length( viewDelta ) / scale;
					float weight = 1.;
					float occlusion = max(0., (dot(viewNormal, viewDelta) - minResolution) / scaledViewDist - bias) / (1. + scaledViewDist * scaledViewDist );
				#else
					// SSAO
					float weight = 1.;
					float occlusion = step(sceneSampleDist + bias, sampleDist);
				#endif

		#if AO_ALGORITHM == 4	
				}
				// GTAO
				vec2 sinHorizons = sqrt(1. - cosHorizons * cosHorizons);
				float nx = dot(normalInSlice, sliceTangent);
				float ny = dot(normalInSlice, viewDir);
				float nxb = 1. / 2. * (acos(cosHorizons.y) - acos(cosHorizons.x) + sinHorizons.x * cosHorizons.x - sinHorizons.y * cosHorizons.y);
				float nyb = 1. / 2. * (2. - cosHorizons.x * cosHorizons.x - cosHorizons.y * cosHorizons.y);
				float occlusion = nx * nxb + ny * nyb;
				ao += occlusion;
			}
			ao = clamp(ao / float(DIRECTIONS), 0., 1.);	
		#elif AO_ALGORITHM == 3
				}
				totalWeight += 1.;
				ao += max(0., cosHorizons.x - max(0., cosHorizons.y));
			}
			ao /= totalWeight + 1. - step(0., totalWeight);
			ao = clamp(1. - ao, 0., 1.);
		#else

				float fallOff = getFallOff(sceneSampleDist - sampleDist, distanceFalloffToUse);
				occlusion *= fallOff;
				vec2 diff = (vUv - sampleSceneUvDepth.xy) * resolution;
				occlusion *= step(1., dot(diff, diff));
				vec2 clipRangeCheck = step(0., sampleSceneUvDepth.xy) * step(sampleSceneUvDepth.xy, vec2(1.));
				occlusion *= clipRangeCheck.x * clipRangeCheck.y;
				weight *= clipRangeCheck.x * clipRangeCheck.y;
				totalWeight += weight;
				ao += occlusion;
			}
			ao /= totalWeight + 1. - step(0., totalWeight);
			ao = clamp(1. - ao, 0., 1.);
		#endif	

		#if SCENE_CLIP_BOX == 1
			ao = mix(ao, 1., smoothstep(0., radiusToUse, boxDistance));
		#endif
		#if AO_ALGORITHM != 1
			ao = pow(ao, scale);
		#endif
			gl_FragColor = FRAGMENT_OUTPUT;
		}`,
};
