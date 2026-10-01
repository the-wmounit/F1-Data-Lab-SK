import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sampleAt } from './math.js';
import { createTrackGeometry } from './road.js';

export class ReplayScene {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x171c16);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.host.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, .1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .07;
    this.controls.maxPolarAngle = Math.PI * .48;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 380;
    this.scene.add(new THREE.HemisphereLight(0xe7efd6, 0x34382e, 2));
    const light = new THREE.DirectionalLight(0xfff5d9, 2.5);light.position.set(20,60,-20);light.castShadow=true;
    light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-90,right:90,top:90,bottom:-90,near:1,far:180});light.shadow.bias=-.0005;light.shadow.normalBias=.025;this.scene.add(light);this.light=light;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.cars = new Map(); this.mode = 'orbit';
    this.modelTemplate = null;this.disposed=false;
    this.modelPromise = new GLTFLoader().loadAsync('/models/f1-2026.glb').then(gltf => {
      if(this.disposed){this.disposeTemplate(gltf.scene);return;}
      this.modelTemplate = gltf.scene;
      for (const car of this.cars.values()) this.installModel(car);
      document.querySelector('#model-caption').textContent='Monoplace 2026 · teintes des écuries';
    }).catch(error => {
      document.querySelector('#model-caption').textContent='Modèle indisponible · repères simples';
      console.error('Chargement du modèle 3D local',error);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.resize();
    host.addEventListener('keydown', e => {
      if (this.mode !== 'orbit' || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (e.key === 'ArrowLeft') spherical.theta -= .12;
      if (e.key === 'ArrowRight') spherical.theta += .12;
      if (e.key === 'ArrowUp') spherical.radius *= .9;
      if (e.key === 'ArrowDown') spherical.radius *= 1.1;
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    });
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); document.querySelector('#message').hidden=false;
      document.querySelector('#message').textContent='Le contexte 3D a été interrompu. Rechargez la page pour reprendre le replay.';
    });
  }
  resize() { const w=this.host.clientWidth, h=this.host.clientHeight; this.renderer.setSize(w,h); this.camera.aspect=w/Math.max(h,1); this.camera.updateProjectionMatrix(); }
  load(replay) {
    this.clear(); this.replay = replay;
    const trace = replay.circuit.points;
    const xs=trace.map(p=>p[0]), ys=trace.map(p=>p[1]), zs=trace.map(p=>p[2]);
    const range=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1);
    this.scale=115/range;
    this.center=[(Math.max(...xs)+Math.min(...xs))/2,(Math.max(...ys)+Math.min(...ys))/2,Math.min(...zs)];
    const vectors=trace.map(p=>this.map(p));
    const curve=new THREE.CatmullRomCurve3(vectors,true,'centripetal');
    const geometry=createTrackGeometry(curve,Math.max(1200,trace.length*3));
    const road=new THREE.Mesh(geometry.road,new THREE.MeshStandardMaterial({map:this.makeAsphalt(),roughness:.98,metalness:0}));
    road.receiveShadow=true;
    const shoulders=new THREE.Mesh(geometry.shoulders,new THREE.MeshStandardMaterial({color:0x8d816b,roughness:1}));
    const edgeLines=new THREE.Mesh(geometry.edgeLines,new THREE.MeshBasicMaterial({color:0xe6e5d9}));
    const curbs=new THREE.Mesh(geometry.curbs,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85}));
    this.group.add(shoulders,road,edgeLines,curbs);
    const floorY=Math.min(...vectors.map(v=>v.y))-1.7;
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(700,700),new THREE.MeshStandardMaterial({color:0x6c6252,roughness:1}));
    floor.rotation.x=-Math.PI/2;floor.position.y=floorY;this.group.add(floor);
    floor.receiveShadow=true;
    // A start/finish strip derived from the first trace point, perpendicular to its tangent.
    const start=vectors[0], tangent=vectors[1].clone().sub(start).normalize();
    const flag=new THREE.Mesh(new THREE.PlaneGeometry(4.2,.24),new THREE.MeshBasicMaterial({map:this.makeStartLine()}));
    flag.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(tangent.x,tangent.z)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));flag.position.copy(start).add(new THREE.Vector3(0,.025,0));this.group.add(flag);
    this.home=new THREE.Vector3(95,115,105);this.target=new THREE.Vector3(0,Math.max(...vectors.map(v=>v.y))/2,0);
    for (const driver of replay.drivers) {
      const group=new THREE.Group();
      const sphere=new THREE.Mesh(new THREE.SphereGeometry(.65,16,12),new THREE.MeshBasicMaterial({color:driver.color}));
      const aura=new THREE.Mesh(new THREE.SphereGeometry(1.15,12,8),new THREE.MeshBasicMaterial({color:driver.color,transparent:true,opacity:.12,depthWrite:false}));
      const visual=new THREE.Group();visual.add(sphere,aura);group.add(visual);this.group.add(group);
      const ring=new THREE.Mesh(new THREE.RingGeometry(1.35,1.46,32),new THREE.MeshBasicMaterial({color:0xd8ef67,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2;ring.position.y=.04;group.add(ring);
      const trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:driver.color,transparent:true,opacity:.45}));this.group.add(trail);
      const label=this.makeLabel(driver.code,driver.color);group.add(label);
      const car={driver,group,visual,ring,trail,label,position:null,direction:new THREE.Vector3(0,0,1)};
      this.cars.set(driver.driverId,car);
      if(this.modelTemplate)this.installModel(car);
    }
    this.selected=replay.drivers[0]?.driverId;this.reset();this.render(0);
  }
  map(p) { return new THREE.Vector3((p[0]-this.center[0])*this.scale,(p[2]-this.center[2])*this.scale+.15,-(p[1]-this.center[1])*this.scale); }
  makeAsphalt(){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(128,128);let seed=17;
    for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const grain=(seed>>>27)-16;pixels.data[i]=48+grain*.35;pixels.data[i+1]=50+grain*.35;pixels.data[i+2]=49+grain*.35;pixels.data[i+3]=255;}
    ctx.putImageData(pixels,0,0);const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(4,4);texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());return texture;
  }
  makeStartLine(){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=16;const ctx=canvas.getContext('2d');for(let row=0;row<2;row++)for(let col=0;col<16;col++){ctx.fillStyle=(row+col)%2?'#22231f':'#eeeeea';ctx.fillRect(col*8,row*8,8,8);}const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;}
  installModel(car) {
    car.group.remove(car.visual);
    car.visual.traverse(mesh=>{mesh.geometry?.dispose();mesh.material?.dispose();});
    const model=this.modelTemplate.clone(true);
    model.scale.setScalar(.5);
    model.traverse(mesh=>{
      if(!mesh.isMesh)return;
      mesh.userData.replayAsset=true;mesh.castShadow=true;
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      const own=materials.map(source=>{
        const material=source.clone();
        // Keep livery details and carbon areas while replacing its blue base with
        // team colours. These are illustrative liveries on the supplied 2026 mesh.
        if(source.name==='Livery'){
          material.color.set(car.driver.color);
          material.onBeforeCompile=shader=>{
            const map=THREE.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;',
              'sampledDiffuseColor.rgb = vec3(pow(dot(sampledDiffuseColor.rgb, vec3(0.2126,0.7152,0.0722)), 0.55)); diffuseColor *= sampledDiffuseColor;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',map);
          };
          material.customProgramCacheKey=()=> 'f1-team-livery-v1';
        }
        return material;
      });
      mesh.material=Array.isArray(mesh.material)?own:own[0];
    });
    car.visual=model;car.group.add(model);
  }
  makeLabel(text,color) {
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=60;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#182014';ctx.fillRect(0,0,160,60);ctx.fillStyle=color;ctx.fillRect(0,0,5,60);
    ctx.fillStyle='#ffffff';ctx.font='600 32px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,84,31);
    const texture=new THREE.CanvasTexture(canvas);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}));sprite.position.y=2.6;sprite.scale.set(3,1.12,1);return sprite;
  }
  setMode(mode) { this.mode=mode;this.controls.enabled=mode==='orbit'; if(mode==='orbit')this.reset(); }
  select(id) { this.selected=id; }
  reset() { if(!this.home)return;this.camera.position.copy(this.home);this.controls.target.copy(this.target);this.controls.update(); }
  render(time) {
    if (!this.replay) return;
    for(const [id,car] of this.cars) {
      const point=sampleAt(car.driver.points,time);
      car.group.visible=!!point;car.trail.visible=!!point&&!(id===this.selected&&this.mode==='onboard');car.label.visible=id===this.selected&&this.mode==='orbit';
      car.ring.visible=id===this.selected&&this.mode==='orbit';
      car.visual.visible=!(id===this.selected&&this.mode==='onboard');
      if(!point){car.position=null;continue;}
      car.position=this.map(point).add(new THREE.Vector3(0,.045,0));car.group.position.copy(car.position);
      const ahead=sampleAt(car.driver.points,time+.6), behind=sampleAt(car.driver.points,time-.6);
      const direction=ahead?this.map(ahead).sub(this.map(point)):behind?this.map(point).sub(this.map(behind)):null;
      if(direction&&Math.hypot(direction.x,direction.z)>.01){const horizontal=Math.hypot(direction.x,direction.z);car.direction.set(direction.x,0,direction.z).normalize();car.visual.rotation.set(-Math.atan2(direction.y,horizontal),Math.atan2(direction.x,direction.z),0,'YXZ');}
      const trailPoints=[];
      for(let j=0;j<6;j++){const p=sampleAt(car.driver.points,time-j*.65);if(!p)break;trailPoints.push(this.map(p).add(new THREE.Vector3(0,.06,0)));}
      car.trail.geometry.dispose();car.trail.geometry=new THREE.BufferGeometry().setFromPoints(trailPoints);
    }
    if(this.mode==='onboard'||this.mode==='follow'){
      const car=this.cars.get(this.selected);
      if(car?.position){
        const onboard=this.mode==='onboard';
        this.camera.position.copy(car.position).addScaledVector(car.direction,onboard?.25:-5.5).add(new THREE.Vector3(0,onboard?1.1:3.2,0));
        this.camera.lookAt(car.position.clone().addScaledVector(car.direction,onboard?8:.2).add(new THREE.Vector3(0,.35,0)));
      }
    }else{this.controls.update();}
    this.renderer.render(this.scene,this.camera);
  }
  clear(){for(const child of [...this.group.children]){child.traverse(o=>{if(!o.userData.replayAsset)o.geometry?.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!o.userData.replayAsset)m?.map?.dispose();m?.dispose();}});this.group.remove(child);}this.cars.clear();}
  disposeTemplate(root){const resources=new Set();root.traverse(o=>{if(o.geometry)resources.add(o.geometry);const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m){resources.add(m);if(m.map)resources.add(m.map);}}});for(const resource of resources){resource.source?.data?.close?.();resource.dispose();}}
  dispose(){this.disposed=true;this.clear();if(this.modelTemplate)this.disposeTemplate(this.modelTemplate);this.light.shadow.map?.dispose();this.resizeObserver.disconnect();this.controls.dispose();this.renderer.dispose();}
}
