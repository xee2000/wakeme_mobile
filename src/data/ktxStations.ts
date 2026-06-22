// KTX 역 데이터 (한국철도공사 공공데이터 기반 + 좌표 추가)
// 출처: 한국철도공사_KTX 노선별 역정보_20251121

export interface KtxStation {
  id: string;      // 역명 (고유 키)
  name: string;    // 표시 이름
  lat: number;
  lng: number;
  lines: string[]; // 운행 노선
}

export const KTX_STATIONS: KtxStation[] = [
  { id: '행신',        name: '행신',        lat: 37.6085, lng: 126.8317, lines: ['경부선','호남선','강릉선','경전선'] },
  { id: '서울',        name: '서울(서울역)', lat: 37.5546, lng: 126.9706, lines: ['경부선','호남선','강릉선','경전선','중앙선','전라선'] },
  { id: '용산',        name: '용산',        lat: 37.5300, lng: 126.9649, lines: ['호남선','전라선'] },
  { id: '영등포',      name: '영등포',      lat: 37.5156, lng: 126.9074, lines: ['경부선'] },
  { id: '광명',        name: '광명',        lat: 37.4188, lng: 126.8586, lines: ['경부선','호남선','경전선','전라선'] },
  { id: '수원',        name: '수원',        lat: 37.2647, lng: 127.0002, lines: ['경부선'] },
  { id: '천안아산',    name: '천안아산',    lat: 36.7947, lng: 127.1047, lines: ['경부선','호남선','경전선','전라선'] },
  { id: '오송',        name: '오송',        lat: 36.6249, lng: 127.3094, lines: ['경부선','호남선','경전선','전라선'] },
  { id: '대전',        name: '대전',        lat: 36.3318, lng: 127.4346, lines: ['경부선','경전선'] },
  { id: '서대전',      name: '서대전',      lat: 36.3213, lng: 127.4059, lines: ['호남선','전라선'] },
  { id: '계룡',        name: '계룡',        lat: 36.2789, lng: 127.2509, lines: ['호남선','전라선'] },
  { id: '논산',        name: '논산',        lat: 36.1870, lng: 127.1002, lines: ['호남선','전라선'] },
  { id: '공주',        name: '공주',        lat: 36.4778, lng: 127.1248, lines: ['호남선','전라선'] },
  { id: '익산',        name: '익산',        lat: 35.9394, lng: 126.9546, lines: ['호남선','전라선'] },
  { id: '전주',        name: '전주',        lat: 35.7963, lng: 127.0817, lines: ['전라선'] },
  { id: '정읍',        name: '정읍',        lat: 35.5668, lng: 126.8559, lines: ['호남선'] },
  { id: '나주',        name: '나주',        lat: 35.0356, lng: 126.7137, lines: ['호남선'] },
  { id: '광주송정',    name: '광주송정',    lat: 35.1396, lng: 126.7930, lines: ['호남선'] },
  { id: '장성',        name: '장성',        lat: 35.2994, lng: 126.7863, lines: ['호남선'] },
  { id: '목포',        name: '목포',        lat: 34.8127, lng: 126.3926, lines: ['호남선'] },
  { id: '김천구미',    name: '김천구미',    lat: 36.1309, lng: 128.0926, lines: ['경부선','경전선'] },
  { id: '서대구',      name: '서대구',      lat: 35.8710, lng: 128.5617, lines: ['경부선','경전선'] },
  { id: '동대구',      name: '동대구',      lat: 35.8799, lng: 128.6277, lines: ['경부선','경전선'] },
  { id: '경산',        name: '경산',        lat: 35.8307, lng: 128.7409, lines: ['경부선','경전선'] },
  { id: '밀양',        name: '밀양',        lat: 35.4935, lng: 128.7518, lines: ['경부선','경전선'] },
  { id: '물금',        name: '물금',        lat: 35.3168, lng: 128.9710, lines: ['경부선'] },
  { id: '구포',        name: '구포',        lat: 35.2010, lng: 128.9897, lines: ['경부선'] },
  { id: '부산',        name: '부산',        lat: 35.1147, lng: 129.0420, lines: ['경부선','경전선'] },
  { id: '울산(통도사)',name: '울산(통도사)',  lat: 35.5558, lng: 129.1829, lines: ['경부선'] },
  { id: '경주',        name: '경주',        lat: 35.8562, lng: 129.2257, lines: ['경부선'] },
  { id: '포항',        name: '포항',        lat: 36.0199, lng: 129.3533, lines: ['경부선'] },
  { id: '진영',        name: '진영',        lat: 35.4789, lng: 128.7387, lines: ['경전선'] },
  { id: '창원중앙',    name: '창원중앙',    lat: 35.2396, lng: 128.5823, lines: ['경전선'] },
  { id: '창원',        name: '창원',        lat: 35.2275, lng: 128.6814, lines: ['경전선'] },
  { id: '마산',        name: '마산',        lat: 35.2091, lng: 128.5745, lines: ['경전선'] },
  { id: '진주',        name: '진주',        lat: 35.1546, lng: 128.1008, lines: ['경전선'] },
  { id: '순천',        name: '순천',        lat: 34.9400, lng: 127.4945, lines: ['전라선'] },
  { id: '곡성',        name: '곡성',        lat: 35.2820, lng: 127.2926, lines: ['전라선'] },
  { id: '구례구',      name: '구례구',      lat: 35.2037, lng: 127.4576, lines: ['전라선'] },
  { id: '남원',        name: '남원',        lat: 35.4040, lng: 127.3920, lines: ['전라선'] },
  { id: '여수EXPO',    name: '여수EXPO',    lat: 34.7434, lng: 127.7378, lines: ['전라선'] },
  { id: '여천',        name: '여천',        lat: 34.7588, lng: 127.6669, lines: ['전라선'] },
  { id: '김제',        name: '김제',        lat: 35.8033, lng: 126.8805, lines: ['호남선'] },
  { id: '청량리',      name: '청량리',      lat: 37.5802, lng: 127.0473, lines: ['강릉선','중앙선'] },
  { id: '상봉',        name: '상봉',        lat: 37.5680, lng: 127.0921, lines: ['강릉선'] },
  { id: '덕소',        name: '덕소',        lat: 37.5725, lng: 127.2045, lines: ['강릉선'] },
  { id: '양평',        name: '양평',        lat: 37.4919, lng: 127.4924, lines: ['강릉선','중앙선'] },
  { id: '서원주',      name: '서원주',      lat: 37.3175, lng: 127.8991, lines: ['강릉선','중앙선'] },
  { id: '원주',        name: '원주',        lat: 37.3406, lng: 127.9207, lines: ['중앙선'] },
  { id: '만종',        name: '만종',        lat: 37.3551, lng: 127.7965, lines: ['강릉선'] },
  { id: '횡성',        name: '횡성',        lat: 37.4918, lng: 127.9837, lines: ['강릉선'] },
  { id: '둔내',        name: '둔내',        lat: 37.5157, lng: 128.2163, lines: ['강릉선'] },
  { id: '평창',        name: '평창',        lat: 37.5875, lng: 128.4061, lines: ['강릉선'] },
  { id: '진부(오대산)',name: '진부(오대산)', lat: 37.6564, lng: 128.5740, lines: ['강릉선'] },
  { id: '강릉',        name: '강릉',        lat: 37.7681, lng: 128.9065, lines: ['강릉선'] },
  { id: '정동진',      name: '정동진',      lat: 37.6766, lng: 129.0558, lines: ['강릉선'] },
  { id: '묵호',        name: '묵호',        lat: 37.5550, lng: 129.1097, lines: ['강릉선'] },
  { id: '동해',        name: '동해',        lat: 37.5251, lng: 129.1218, lines: ['강릉선'] },
  { id: '판교(경기)',  name: '판교(경기)',  lat: 37.3918, lng: 127.1115, lines: ['중부내륙선'] },
  { id: '부발',        name: '부발',        lat: 37.2399, lng: 127.3765, lines: ['중부내륙선'] },
  { id: '가남',        name: '가남',        lat: 37.1538, lng: 127.4743, lines: ['중부내륙선'] },
  { id: '감곡장호원',  name: '감곡장호원',  lat: 37.0742, lng: 127.5516, lines: ['중부내륙선'] },
  { id: '충주',        name: '충주',        lat: 36.9711, lng: 127.8888, lines: ['중부내륙선'] },
  { id: '앙성온천',    name: '앙성온천',    lat: 36.9165, lng: 127.9799, lines: ['중부내륙선'] },
  { id: '제천',        name: '제천',        lat: 37.1345, lng: 128.2015, lines: ['중앙선'] },
  { id: '단양',        name: '단양',        lat: 36.9889, lng: 128.3656, lines: ['중앙선'] },
  { id: '풍기',        name: '풍기',        lat: 36.8932, lng: 128.4848, lines: ['중앙선'] },
  { id: '영주',        name: '영주',        lat: 36.8068, lng: 128.6288, lines: ['중앙선'] },
  { id: '안동',        name: '안동',        lat: 36.5667, lng: 128.7305, lines: ['중앙선'] },
];

/** 역명으로 역 정보 조회 */
export function findKtxStation(id: string): KtxStation | undefined {
  return KTX_STATIONS.find(s => s.id === id);
}

/** 검색어로 역 필터링 */
export function searchKtxStations(query: string): KtxStation[] {
  const q = query.trim().toLowerCase();
  if (!q) return KTX_STATIONS;
  return KTX_STATIONS.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.lines.some(l => l.includes(q))
  );
}
