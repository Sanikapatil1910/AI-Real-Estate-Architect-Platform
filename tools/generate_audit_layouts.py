"""Generates 30 varied layouts (2 plans each) through the running backend (POST /generate) into frontend-react/dev/fixtures/gen2_*.json, fixed seed.
Start the API first; run from the repository root.  Used for the walkability audit (docs/VR_ACCESSIBILITY_REPORT.md)."""
import json, random, urllib.request, sys
random.seed(11)
OUT='frontend-react/dev/fixtures'
styles=['Modern Minimalistic','Traditional Indian','Maharashtrian Wada']
def rooms_for(beds,baths,extra=()):
    names=["living_room","dining","kitchen","master_bedroom"]+["bedroom"]*(beds-1)+["bathroom"]*baths+list(extra)
    return [{"room_type":t} for t in names]
cfgs=[]
sizes=[(25,40),(30,40),(30,50),(35,45),(40,50),(40,60),(45,60),(50,60),(50,70),(60,80),(32,48),(28,45)]
for i in range(30):
    w,l=random.choice(sizes)
    if random.random()<.3: w,l=l,w
    bt=random.choice(['Ground','G+1','G+1','G+2'])
    beds=random.choice([2,3,3,4]) if bt!='Ground' else random.choice([2,3])
    baths=min(beds,random.choice([2,3,4]))
    extra=[]
    if random.random()<.4: extra.append('puja_room')
    if random.random()<.3: extra.append('study')
    if random.random()<.25: extra.append('utility')
    p=dict(plot_width=w,plot_length=l,frontage_ft=w,road_side=random.choice(['North','South','East','West']),building_type=bt,rooms=rooms_for(beds,baths,extra),
      vastu_mode=random.choice(['no_preference','strict','no_preference']),architectural_style=random.choice(styles),parking_required=random.random()<.4,
      parking_spaces=1,parking_type=random.choice(['1 Car','Car + Bikes']),include_terrace=bt!='Ground' and random.random()<.5,balcony_required=bt!='Ground' and random.random()<.4,
      garden_required=random.random()<.2,strict=False,number_of_plans=2,setbacks=dict(front=random.choice([0,5,6]),rear=random.choice([0,3,4]),left=random.choice([0,3]),right=random.choice([0,3])))
    cfgs.append(p)
saved=[]
import os
for i,p in enumerate(cfgs):
    req=urllib.request.Request('http://127.0.0.1:8000/generate',data=json.dumps(p).encode(),headers={'Content-Type':'application/json'})
    try:
        r=json.load(urllib.request.urlopen(req,timeout=150))
    except Exception as e:
        print(i,'ERR',str(e)[:120], p['plot_width'],p['plot_length'],p['building_type']); continue
    plans=r.get('plans') or r.get('results') or []
    if not plans and isinstance(r,dict): print(i,'keys',list(r.keys())[:10]); continue
    for k,pl in enumerate(plans[:2]):
        n=f"gen2_{i:02d}_p{k}"
        json.dump(pl,open(f'{OUT}/{n}.json','w'))
        saved.append(n)
    print(i,p['plot_width'],p['plot_length'],p['building_type'],p['road_side'],p['architectural_style'][:6],p['vastu_mode'],'plans',len(plans))
pass
print('saved',len(saved))
