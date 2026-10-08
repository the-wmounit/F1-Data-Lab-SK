# Contrat local v1

Les nombres sont numériques et les noms JSON en camelCase. Aucun appel distant au runtime.

- `data/catalog.json`: `{schemaVersion:1, races:[{year,round,name,circuit,country,date,laps,sessionKey}]}`. Deux replays 2024, manches 1 et 2.
- `data/2024/1/results.json` (idem 2): `{year,round,drivers:[{driverId,number,code,name,team,color,position,grid,laps,points,status,fastestLapRank}]}`. Couleurs hexadécimales `#RRGGBB`.
- `laps.json`: `{year,round,laps:[{lap,timings:[{driverId,position,timeSeconds}]}]}`.
- `pits.json`: `{year,round,stops:[{driverId,lap,stop,durationSeconds,time}]}`.
- `replay.json`: `{schemaVersion:1,year,round,sessionKey,originUtc,durationSeconds,sampleHz:1,coordinateSystem:"OpenF1 local coordinates (approximate)",circuit:{driverId,lap,points:[[x,y,z],...]},drivers:[{driverId,number,code,name,team,color,points:[[t,x,y,z],...],gaps:[{from,to}]}],quality:{rawPoints,sampledPoints,gapCount,maxGapSeconds,notes:[...]},sources:[{url,fetchedAt,sha256}]}`. `t` est en secondes depuis originUtc. Conserver les coordonnées OpenF1 ; ne jamais inventer une altitude ni interpoler de longs trous. Le circuit provient d'un tour complet valide.
- `data/championship-2024.json`: `{year:2024,races:[{round,name,date,results:[{driverId,number,code,name,team,color,position,points,status,fastestLapRank,laps}],sprintResults:[mêmes champs]}],sources:[...]}`. Les points officiels incluent séparément les sprints et le meilleur tour ; les modes what-if changent uniquement les points de course (bonus meilleur tour selon barème, sprints conservés).
- `quality.json`: rapport descriptif avec provenance, comptages, trous, limites.

API : GET `/api/races`, `/api/results/{year}/{round}`, `/api/laps/{year}/{round}`, `/api/pits/{year}/{round}`, `/api/replay/{year}/{round}`, `/api/quality/{year}/{round}`, `/api/championship/{year}?scoring=2024|2010|custom&points=25,18,...`.
Championship renvoie `{year,scoring,points,includesSprints:true,frames:[{round,name,standings:[{driverId,code,name,team,color,points,rank}]}]}`. Ex-aequo départagés par nombre de victoires puis secondes places, etc., puis driverId.

Front : `/` = tableau pédagogique simple ; `/reference/` = interface finale. Three.js bundle local dans `wwwroot/reference/`. Backend dans `src/F1DataLab/`, outils et tests .NET dans `tests/` et/ou `src/`, ingestion source Node dans `scripts/`.
