"""Read a binary glTF (.glb) and report the world-space size of its building geometry (used by the 3D export tests)."""
import struct,json,numpy as np
def load(p):
    b=open(p,'rb').read(); clen,_=struct.unpack('<II',b[12:20]); return json.loads(b[20:20+clen])
def bbox(j,maxext=100):
    nodes=j['nodes']
    def mat(n):
        if 'matrix' in n: return np.array(n['matrix']).reshape(4,4).T
        t=np.array(n.get('translation',[0,0,0])); x,y,z,w=n.get('rotation',[0,0,0,1]); s=np.array(n.get('scale',[1,1,1]))
        R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
        M=np.eye(4); M[:3,:3]=R*s; M[:3,3]=t; return M
    parent={}
    for i,n in enumerate(nodes):
        for c in n.get('children',[]): parent[c]=i
    def world(i):
        M=mat(nodes[i])
        while i in parent: i=parent[i]; M=mat(nodes[i])@M
        return M
    lo=np.array([1e9]*3); hi=np.array([-1e9]*3)
    for i,n in enumerate(nodes):
        if 'mesh' not in n: continue
        W=world(i)
        for pr in j['meshes'][n['mesh']]['primitives']:
            a=j['accessors'][pr['attributes']['POSITION']]
            pts=np.array([(W@np.array([x,y,z,1]))[:3] for x in (a['min'][0],a['max'][0]) for y in (a['min'][1],a['max'][1]) for z in (a['min'][2],a['max'][2])])
            if (pts.max(0)-pts.min(0)).max()>maxext: continue
            lo=np.minimum(lo,pts.min(0)); hi=np.maximum(hi,pts.max(0))
    return lo,hi
def boxes(j, maxext=100):
    """World-space axis-aligned box (lo, hi) of every mesh primitive in the file (ground planes larger than ``maxext`` skipped)."""
    nodes = j['nodes']

    def mat(n):
        if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
        t = np.array(n.get('translation', [0, 0, 0])); x, y, z, w = n.get('rotation', [0, 0, 0, 1]); s = np.array(n.get('scale', [1, 1, 1]))
        R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
        M = np.eye(4); M[:3, :3] = R * s; M[:3, 3] = t; return M
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    out = []
    for i, n in enumerate(nodes):
        if 'mesh' not in n: continue
        k, M = i, mat(nodes[i])
        while k in parent: k = parent[k]; M = mat(nodes[k]) @ M
        for pr in j['meshes'][n['mesh']]['primitives']:
            a = j['accessors'][pr['attributes']['POSITION']]
            pts = np.array([(M @ np.array([x, y, z, 1]))[:3] for x in (a['min'][0], a['max'][0]) for y in (a['min'][1], a['max'][1]) for z in (a['min'][2], a['max'][2])])
            if (pts.max(0) - pts.min(0)).max() > maxext: continue
            out.append((pts.min(0), pts.max(0)))
    return out

if __name__=="__main__":
    import sys
    for f in sys.argv[1:]:
        lo,hi=bbox(load(f)); print(f,np.round(hi-lo,1),np.round(lo,1))
