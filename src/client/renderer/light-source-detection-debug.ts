import type {
  LightGraph,
  LightSample,
  LightSource,
  LightSourceDetector,
} from './light-source-detection';
import type { ColorRepresentation, Material, Scene } from 'three';
import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
} from 'three';

export class LightSourceDetectorDebug {
  private _lightSourceDetector: LightSourceDetector;
  private _scene?: Scene;

  constructor(lightSourceDetector: LightSourceDetector) {
    this._lightSourceDetector = lightSourceDetector;
  }

  public static createPlane(scene: Scene, material?: Material): Mesh {
    const planeGeometry = new PlaneGeometry(2, 1);
    const planeMaterial =
      material ?? new MeshBasicMaterial({ color: 0xc0c0c0, side: DoubleSide });
    const planeMesh = new Mesh(planeGeometry, planeMaterial);
    planeMesh.position.z = -0.1;
    scene.add(planeMesh);
    return planeMesh;
  }

  public createDebugScene(scene: Scene, maxNoOfLightSources?: number): void {
    this._scene = scene;
    this._createLightGraphInMap(
      this._lightSourceDetector.sampleUVs,
      this._lightSourceDetector.lightSamples,
      this._lightSourceDetector.lightGraph,
      maxNoOfLightSources
    );
  }

  private _createLightGraphInMap(
    allLightSamplesUVs: Vector2[],
    lightSamples: LightSample[],
    lightGraph: LightGraph,
    maxNoOfLightSources?: number
  ) {
    const singleLightSamples: LightSample[] = [];
    const clusterLightSamples: LightSample[] = [];
    for (let i = 0; i < this._lightSourceDetector.lightGraph.noOfNodes; ++i) {
      if (lightGraph.adjacent[i].length === 0) {
        singleLightSamples.push(lightSamples[i]);
      } else {
        clusterLightSamples.push(lightSamples[i]);
      }
    }
    const singleLightSampleUVs = singleLightSamples.map((sample) => sample.uv);
    const clusterLightSampleUVs = clusterLightSamples.map(
      (sample) => sample.uv
    );
    const discardedSamples = allLightSamplesUVs.filter(
      (uv) =>
        !singleLightSampleUVs.includes(uv) &&
        !clusterLightSampleUVs.includes(uv)
    );
    this._createSamplePointsInMap(discardedSamples, 0.005, 0xff0000);
    this._createSamplePointsInMap(singleLightSampleUVs, 0.01, 0x0000ff);
    this._createSamplePointsInMap(clusterLightSampleUVs, 0.01, 0x00ff00);
    this._createClusterLinesInMap(
      this._lightSourceDetector.lightSamples,
      this._lightSourceDetector.lightGraph.edges,
      0x000080
    );
    const lightSourceUVs = this._lightSourceDetector.lightSources.map(
      (lightSource) => lightSource.uv
    );
    this._createSamplePointsInMap(lightSourceUVs, 0.015, 0xffff00);
    let lightSources = this._lightSourceDetector.lightSources;
    if (
      maxNoOfLightSources !== undefined &&
      maxNoOfLightSources >= 0 &&
      maxNoOfLightSources < lightSources.length
    ) {
      lightSources = lightSources.slice(0, maxNoOfLightSources);
    }
    this._createCirclesInMap(lightSources, 0x808000);
  }

  private _createSamplePointsInMap(
    samplePoints: Vector2[],
    radius: number,
    color: ColorRepresentation
  ) {
    // TODO TREE.Points https://threejs.org/docs/#api/en/objects/Points
    const samplePointGeometry = new CircleGeometry(radius, 8, 4);
    const samplePointMaterial = new MeshBasicMaterial({ color });
    samplePoints.forEach((samplePoint: Vector2) => {
      const samplePointMesh = new Mesh(
        samplePointGeometry,
        samplePointMaterial
      );
      samplePointMesh.position.copy(this._uvToMapPosition(samplePoint));
      samplePointMesh.name = 'samplePoint';
      this._scene?.add(samplePointMesh);
    });
  }

  private _createCirclesInMap(
    lightSources: LightSource[],
    color: ColorRepresentation
  ) {
    const samplePointMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
    });
    lightSources.forEach((lightSource: LightSource) => {
      const samplePointGeometry = new CircleGeometry(lightSource.size, 8, 4);
      const samplePointMesh = new Mesh(
        samplePointGeometry,
        samplePointMaterial
      );
      samplePointMesh.position.copy(this._uvToMapPosition(lightSource.uv));
      samplePointMesh.name = 'samplePoint';
      this._scene?.add(samplePointMesh);
    });
  }

  private _createClusterLinesInMap(
    lightSamples: LightSample[],
    clusterSegments: number[][],
    color: ColorRepresentation
  ) {
    const lineMaterial = new LineBasicMaterial({ color });
    const points: Vector3[] = [];
    clusterSegments.forEach((cluster: number[]) => {
      for (let i = 1; i < cluster.length; i++) {
        const uv0 = lightSamples[cluster[0]].uv;
        const uv1 = lightSamples[cluster[i]].uv;
        points.push(this._uvToMapPosition(uv0));
        if (Math.abs(uv0.x - uv1.x) > 0.5) {
          const v = (uv0.y + uv1.y) / 2;
          const u = uv0.x < uv1.x ? 0 : 1;
          points.push(this._uvToMapPosition(new Vector2(u, v)));
          points.push(this._uvToMapPosition(new Vector2(1 - u, v)));
        }
        points.push(this._uvToMapPosition(uv1));
      }
    });
    const lineGeometry = new BufferGeometry().setFromPoints(points);
    const lineMesh = new LineSegments(lineGeometry, lineMaterial);
    lineMesh.name = 'clusterLine';
    this._scene?.add(lineMesh);
  }

  private _uvToMapPosition(uv: Vector2): Vector3 {
    return new Vector3(uv.x * 2 - 1, uv.y - 0.5, 0);
  }
}
