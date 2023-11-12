import type { WebGLRenderer } from 'three';
import {
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';

export const sphereToEquirectangular = (pointOnSphere: Vector3): Vector2 => {
  const u = Math.atan2(pointOnSphere.y, pointOnSphere.x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(pointOnSphere.z) / Math.PI + 0.5;
  return new Vector2(u, v);
};

export const equirectangularToSphere = (uv: Vector2): Vector3 => {
  const theta = (uv.x - 0.5) * 2 * Math.PI;
  const phi = (uv.y - 0.5) * Math.PI;
  const length = Math.cos(phi);
  return new Vector3(
    Math.cos(theta) * length,
    Math.sin(theta) * length,
    Math.sin(phi),
  );
};

export interface TextureConverterResult {
  texture: Texture;
  pixels: Uint8Array;
}

export class TextureConverter {
  private _colorRenderTarget?: WebGLRenderTarget;
  private _environmentMapDecodeTarget?: WebGLRenderTarget;
  private _equirectangularDecodeMaterial?: EnvironmentMapDecodeMaterial;
  private _pmremDecodeMaterial?: EnvironmentMapDecodeMaterial;
  private _camera?: OrthographicCamera;
  private _planeMesh?: Mesh;

  get colorRenderTarget(): WebGLRenderTarget {
    this._colorRenderTarget =
      this._colorRenderTarget ?? new WebGLRenderTarget();
    return this._colorRenderTarget;
  }

  get environmentMapDecodeTarget(): WebGLRenderTarget {
    this._environmentMapDecodeTarget =
      this._environmentMapDecodeTarget ?? new WebGLRenderTarget();
    //this._grayscaleRenderTarget = this._environmentMapDecodeTarget ?? new WebGLRenderTarget(1, 1, { format: RedFormat });
    return this._environmentMapDecodeTarget;
  }

  public environmentMapDecodeMaterial(
    decodePmrem: boolean,
  ): EnvironmentMapDecodeMaterial {
    if (decodePmrem) {
      this._equirectangularDecodeMaterial =
        this._equirectangularDecodeMaterial ??
        new EnvironmentMapDecodeMaterial(true, false);
      return this._equirectangularDecodeMaterial;
    } else {
      this._pmremDecodeMaterial =
        this._pmremDecodeMaterial ??
        new EnvironmentMapDecodeMaterial(false, false);
      return this._pmremDecodeMaterial;
    }
  }

  get camera(): OrthographicCamera {
    this._camera = this._camera ?? new OrthographicCamera(-1, 1, 1, -1, -1, 1);
    return this._camera;
  }

  public scaleTexture(
    renderer: WebGLRenderer,
    texture: Texture,
    targetWidth: number,
    targetHeight: number,
  ): TextureConverterResult {
    this.colorRenderTarget.setSize(targetWidth, targetHeight);
    this._planeMesh =
      this._planeMesh ??
      new Mesh(
        new PlaneGeometry(2, 2),
        new MeshBasicMaterial({ map: texture }),
      );
    const renderTargetBackup = renderer.getRenderTarget();
    renderer.setRenderTarget(this.colorRenderTarget);
    renderer.render(this._planeMesh, this.camera);
    renderer.setRenderTarget(renderTargetBackup);
    const colorTexture = this.environmentMapDecodeTarget.texture;
    const pixelBuffer = new Uint8Array(targetWidth * targetHeight * 4);
    renderer.readRenderTargetPixels(
      this.colorRenderTarget,
      0,
      0,
      targetWidth,
      targetHeight,
      pixelBuffer,
    );
    return { texture: colorTexture, pixels: pixelBuffer };
  }

  public newGrayscaleTexture(
    renderer: WebGLRenderer,
    texture: Texture,
    targetWidth: number,
    targetHeight: number,
  ): TextureConverterResult {
    const decodeMaterial = this.environmentMapDecodeMaterial(
      texture.name === 'PMREM.cubeUv',
    );
    this.environmentMapDecodeTarget.setSize(targetWidth, targetHeight);
    decodeMaterial.setSourceTexture(texture);
    this._planeMesh =
      this._planeMesh ?? new Mesh(new PlaneGeometry(2, 2), decodeMaterial);
    const renderTargetBackup = renderer.getRenderTarget();
    renderer.setRenderTarget(this.environmentMapDecodeTarget);
    renderer.render(this._planeMesh, this.camera);
    renderer.setRenderTarget(renderTargetBackup);
    const grayscaleTexture = this.environmentMapDecodeTarget.texture;
    const pixelBuffer = new Uint8Array(targetWidth * targetHeight * 4);
    renderer.readRenderTargetPixels(
      this.environmentMapDecodeTarget,
      0,
      0,
      targetWidth,
      targetHeight,
      pixelBuffer,
    );
    return { texture: grayscaleTexture, pixels: pixelBuffer };
  }
}

const EnvironmentMapDecodeShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
  },
  vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
        }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        
        float getFace( vec3 direction ) {
          vec3 absDirection = abs( direction );
          float face = - 1.0;
          if ( absDirection.x > absDirection.z ) {
            if ( absDirection.x > absDirection.y )
              face = direction.x > 0.0 ? 0.0 : 3.0;
            else
              face = direction.y > 0.0 ? 1.0 : 4.0;
          } else {
            if ( absDirection.z > absDirection.y )
              face = direction.z > 0.0 ? 2.0 : 5.0;
            else
              face = direction.y > 0.0 ? 1.0 : 4.0;
          }
          return face;
        }

        vec2 getUV( vec3 direction, float face ) {
          vec2 uv;
          if ( face == 0.0 ) {
            uv = vec2( direction.z, direction.y ) / abs( direction.x ); // pos x
          } else if ( face == 1.0 ) {
            uv = vec2( - direction.x, - direction.z ) / abs( direction.y ); // pos y
          } else if ( face == 2.0 ) {
            uv = vec2( - direction.x, direction.y ) / abs( direction.z ); // pos z
          } else if ( face == 3.0 ) {
            uv = vec2( - direction.z, direction.y ) / abs( direction.x ); // neg x
          } else if ( face == 4.0 ) {
            uv = vec2( - direction.x, direction.z ) / abs( direction.y ); // neg y
          } else {
            uv = vec2( direction.x, direction.y ) / abs( direction.z ); // neg z
          }
          return 0.5 * ( uv + 1.0 );
        }

        void main() {
            #if PMREM_DECODE == 1
                float altitude = (vUv.y - 0.5) * 3.141593;
                float azimuth = vUv.x * 2.0 * 3.141593;
                vec3 direction = vec3(
                  cos(altitude) * cos(azimuth) * -1.0, 
                  sin(altitude), 
                  cos(altitude) * sin(azimuth) * -1.0
                );
                float face = getFace(direction);
                vec2 uv = getUV(direction, face) / vec2(3.0, 4.0);
                if (face > 2.5) {
                    uv.y += 0.25;
                    face -= 3.0;
                }
                uv.x += face / 3.0;
                vec4 color = texture2D(tDiffuse, uv);
            #else
                vec4 color = texture2D(tDiffuse, vUv);
            #endif    
            #if GRAYSCALE_CONVERT == 1
                float grayscale = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                //float grayscale = dot(color.rgb, vec3(1.0/3.0));
                gl_FragColor = vec4(vec3(grayscale), 1.0);
            #else
                gl_FragColor = vec4(color.rgb, 1.0);
            #endif
        }`,
};

export class EnvironmentMapDecodeMaterial extends ShaderMaterial {
  constructor(decodePmrem: boolean, grayscale: boolean) {
    super({
      uniforms: UniformsUtils.clone(EnvironmentMapDecodeShader.uniforms),
      vertexShader: EnvironmentMapDecodeShader.vertexShader,
      fragmentShader: EnvironmentMapDecodeShader.fragmentShader,
      defines: {
        PMREM_DECODE: decodePmrem ? 1 : 0,
        GRAYSCALE_CONVERT: grayscale ? 1 : 0,
      },
    });
  }

  setSourceTexture(map: Texture) {
    this.uniforms.tDiffuse.value = map;
  }
}

export class LightSourceDetector {
  private _numberOfSamples: number;
  private _width: number;
  private _height: number;
  private _sampleThreshold: number;
  public readonly pointDistance: number;
  public readonly pixelDistance: number;
  public readonly samplePoints: Vector3[] = [];
  public readonly sampleUVs: Vector2[] = [];
  public textureData?: any;
  public grayscaleTexture: TextureConverterResult = {
    texture: new Texture(),
    pixels: new Uint8Array(0),
  };
  public detectorTexture: Texture = new Texture();
  public detectorArray: Float32Array = new Float32Array(0);
  private _textureConverter?: TextureConverter;
  public lightSamples: LightSample[] = [];
  public lightGraph: LightGraph = new LightGraph(0);
  public lightSources: LightSource[] = [];

  constructor(parameters?: any) {
    this._numberOfSamples = parameters?._numberOfSamples ?? 1000;
    this._width = parameters?._width ?? 1024;
    this._height = parameters?._height ?? 512;
    this._sampleThreshold = parameters?._sampleThreshold ?? 0.707;
    this.pointDistance =
      Math.sqrt(4 * Math.PI) / Math.sqrt(this._numberOfSamples);
    this.pixelDistance = (Math.sqrt(2) * Math.PI * 2) / this._width;
    this.samplePoints = this._createEquirectangularSamplePoints(
      this._numberOfSamples,
    );
    this.sampleUVs = this.samplePoints.map((point) =>
      sphereToEquirectangular(point),
    );
  }

  public detectLightSources(
    renderer: WebGLRenderer,
    equirectangularTexture: Texture,
    textureData?: any,
  ) {
    this.textureData = textureData;
    this._textureConverter = this._textureConverter ?? new TextureConverter();
    this.grayscaleTexture = this._textureConverter.newGrayscaleTexture(
      renderer,
      equirectangularTexture,
      this._width,
      this._height,
    );
    this.detectorArray = this._redFromRgbaToNormalizedFloatArray(
      this.grayscaleTexture.pixels,
    );
    this.detectorTexture = this._grayscaleTextureFromFloatArray(
      this.detectorArray,
      this._width,
      this._height,
    );
    this.lightSamples = this._filterLightSamples(this._sampleThreshold);
    this.lightGraph = this._findClusterSegments(
      this.lightSamples,
      this._sampleThreshold,
    );
    this.lightGraph.findConnectedComponents();
    this.lightSources = this.createLightSourcesFromLightGraph(
      this.lightSamples,
      this.lightGraph,
    );
    this.lightSources.sort((a, b) => b.maxIntensity - a.maxIntensity);
  }

  private _createEquirectangularSamplePoints = (
    numberOfPoints: number,
  ): Vector3[] => {
    const points: Vector3[] = [];
    for (let i = 0; i < numberOfPoints; i++) {
      const spiralAngle = i * Math.PI * (3 - Math.sqrt(5));
      const z = 1 - (i / (numberOfPoints - 1)) * 2;
      const radius = Math.sqrt(1 - z * z);
      const x = Math.cos(spiralAngle) * radius;
      const y = Math.sin(spiralAngle) * radius;
      points.push(new Vector3(x, y, z));
    }
    return points;
  };

  private _redFromRgbaToNormalizedFloatArray(
    rgba: Uint8Array,
    exponent?: number,
  ): Float32Array {
    const floatArray = new Float32Array(rgba.length / 4);
    let minimumValue = 1;
    let maximumValue = 0;
    for (let i = 0; i < rgba.length / 4; ++i) {
      const value = rgba[i * 4] / 255;
      minimumValue = Math.min(minimumValue, value);
      maximumValue = Math.max(maximumValue, value);
      floatArray[i] = value;
    }
    if (exponent) {
      for (let i = 0; i < floatArray.length; ++i) {
        const normalizedValue =
          (floatArray[i] - minimumValue) / (maximumValue - minimumValue);
        floatArray[i] = Math.pow(normalizedValue, exponent);
      }
    } else {
      for (let i = 0; i < floatArray.length; ++i) {
        floatArray[i] =
          (floatArray[i] - minimumValue) / (maximumValue - minimumValue);
      }
    }
    return floatArray;
  }

  private _grayscaleTextureFromFloatArray(
    floatArray: Float32Array,
    _width: number,
    _height: number,
  ): Texture {
    const noOfPixels = _width * _height;
    const uint8data = new Uint8Array(4 * noOfPixels);
    for (let i = 0; i < noOfPixels; i++) {
      const grayscale = floatArray[i] * 255;
      uint8data[i * 4 + 0] = grayscale;
      uint8data[i * 4 + 1] = grayscale;
      uint8data[i * 4 + 2] = grayscale;
      uint8data[i * 4 + 3] = 255;
    }
    const dataTexture = new DataTexture(uint8data, _width, _height);
    dataTexture.needsUpdate = true;
    return dataTexture;
  }

  private _filterLightSamples(threshold: number): LightSample[] {
    const lightSamples: LightSample[] = [];
    for (let i = 0; i < this.sampleUVs.length; i++) {
      const uv = this.sampleUVs[i];
      const value = this._detectorTextureLuminanceValueFromUV(uv);
      if (value > threshold) {
        lightSamples.push(new LightSample(this.samplePoints[i], uv));
      }
    }
    return lightSamples;
  }

  private _detectorTextureLuminanceValueFromUV(uv: Vector2): number {
    const column = Math.floor(uv.x * this._width);
    const row = Math.floor(uv.y * this._height);
    const index = row * this._width + column;
    return this.detectorArray[index];
  }

  private _originalLuminanceValueFromUV(uv: Vector2): number {
    if (
      !this.textureData ||
      !this.textureData.data ||
      !this.textureData._width ||
      !this.textureData._height
    ) {
      return this._detectorTextureLuminanceValueFromUV(uv) * 256;
    }
    const column = Math.floor(uv.x * this.textureData._width);
    const row = Math.floor(uv.y * this.textureData._height);
    let luminance = 0;
    for (let x = Math.max(0, column - 2); x < Math.max(0, column + 2); ++x) {
      for (let y = Math.max(0, row - 2); y < Math.max(0, row + 2); ++y) {
        const index = y * this.textureData._width + x;
        const grayValue =
          (this.textureData.data[index * 4] +
            this.textureData.data[index * 4 + 1] +
            this.textureData.data[index * 4 + 2]) /
          3;
        luminance = Math.max(luminance, grayValue);
      }
    }
    return luminance;
  }

  private _findClusterSegments(
    samples: LightSample[],
    threshold: number,
  ): LightGraph {
    const stepDistance = this.pixelDistance * 2;
    const maxDistance = this.pointDistance * 1.5;
    const lightGraph = new LightGraph(samples.length);
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        if (samples[i].position.angleTo(samples[j].position) < maxDistance) {
          const direction = samples[j].position
            .clone()
            .sub(samples[i].position);
          const steps = Math.floor(direction.length() / stepDistance);
          let inTreshold = true;
          let outOfTresholdCount = 0;
          for (let k = 1; k < steps; k++) {
            const step = direction.clone().multiplyScalar(k / steps);
            const uv = sphereToEquirectangular(
              samples[i].position.clone().add(step).normalize(),
            );
            const value = this._detectorTextureLuminanceValueFromUV(uv);
            if (value < threshold) {
              outOfTresholdCount++;
              if (outOfTresholdCount > 1) {
                inTreshold = false;
                break;
              }
            } else {
              outOfTresholdCount = 0;
            }
          }
          if (inTreshold) {
            lightGraph.adjacent[i].push(j);
            lightGraph.adjacent[j].push(i);
            lightGraph.edges.push([i, j]);
          }
        }
      }
    }
    return lightGraph;
  }

  private createLightSourcesFromLightGraph(
    samples: LightSample[],
    lightGraph: LightGraph,
  ): LightSource[] {
    const lightSources: LightSource[] = lightGraph.components
      .filter((component) => component.length > 1)
      .map(
        (component) =>
          new LightSource(component.map((index) => samples[index])),
      );
    lightSources.forEach((lightSource) =>
      lightSource.calculateLightSourceProperties((uv) =>
        this._originalLuminanceValueFromUV(uv),
      ),
    );
    return lightSources;
  }
}

export class LightSample {
  public readonly position: Vector3;
  public readonly uv: Vector2;

  constructor(position: Vector3, uv: Vector2) {
    this.position = position;
    this.uv = uv;
  }
}

export class LightGraph {
  public readonly noOfNodes: number;
  public edges: number[][] = [];
  public adjacent: number[][] = [];
  public components: number[][] = [];

  constructor(noOfNodes: number) {
    this.noOfNodes = noOfNodes;
    for (let i = 0; i < noOfNodes; i++) {
      this.adjacent.push([]);
    }
  }

  public findConnectedComponents() {
    const visited = new Array(this.noOfNodes).fill(false);
    this.components = [];
    for (let i = 0; i < this.noOfNodes; i++) {
      if (!visited[i]) {
        const component: number[] = [];
        this._dfs(i, visited, component);
        this.components.push(component);
      }
    }
    this.components.sort((a, b) => b.length - a.length);
  }

  private _dfs(node: number, visited: boolean[], component: number[]) {
    visited[node] = true;
    component.push(node);
    for (const adjacentNode of this.adjacent[node]) {
      if (!visited[adjacentNode]) {
        this._dfs(adjacentNode, visited, component);
      }
    }
  }
}

export class LightSource {
  public readonly lightSamples: LightSample[];
  public position: Vector3 = new Vector3();
  public uv: Vector2 = new Vector2();
  public averageIntensity: number = 0;
  public maxIntensity: number = 0;
  public size: number = 0;

  constructor(lightSamples: LightSample[]) {
    this.lightSamples = lightSamples;
  }

  public calculateLightSourceProperties(
    luminanceFunction: (uv: Vector2) => number,
  ) {
    this.position = new Vector3();
    this.averageIntensity = 0;
    this.maxIntensity = 0;
    for (const lightSample of this.lightSamples) {
      this.position.add(lightSample.position);
      const luminanceValue = luminanceFunction(lightSample.uv);
      this.averageIntensity += luminanceValue;
      this.maxIntensity = Math.max(this.maxIntensity, luminanceValue);
    }
    this.averageIntensity /= this.lightSamples.length;
    this.position.normalize();
    this.uv = sphereToEquirectangular(this.position);
    let averageDistance = 0;
    for (const lightSample of this.lightSamples) {
      averageDistance += lightSample.position.distanceTo(this.position);
    }
    averageDistance /= this.lightSamples.length;
    this.size = averageDistance / Math.PI;
  }
}
