export type VisualizationType = 'concert' | 'alley' | 'nightclub'
export type Incident = {
  id: string; tab: string; title: string; location: string; date: string; fatalities: number
  description: string; safetyConcern: string; planningQuestion: string
  sourceUrl: string; sourceName: string; visualizationType: VisualizationType; findings?: string[]
}

export const incidents: Incident[] = [
  {
    id: 'astroworld', tab: 'Astroworld', title: 'Astroworld Festival', location: 'Houston, Texas', date: 'November 5, 2021', fatalities: 10,
    description: 'Severe crowd compression developed during Travis Scott’s performance at Astroworld. Ten people died from compression asphyxia.',
    safetyConcern: 'A densely packed audience with limited room to move around crowd barriers.',
    planningQuestion: 'How do crowd distribution, barriers, and access routes affect congestion?',
    sourceUrl: 'https://toronto.citynews.ca/2021/12/16/officials-astroworld-victims-died-from-compression-asphyxia/', sourceName: 'Associated Press / CityNews', visualizationType: 'concert',
  },
  {
    id: 'itaewon', tab: 'Itaewon', title: 'Itaewon Crowd Crush', location: 'Seoul, South Korea', date: 'October 29, 2022', fatalities: 159,
    description: 'A crowd crush developed in a narrow, sloping alley during Halloween celebrations in Itaewon. Investigators found failures in crowd-safety planning and emergency response.',
    safetyConcern: 'A narrow passage, high crowd density, and inadequate precautions to manage the crowd.',
    planningQuestion: 'How do passage width, crowd size, and opposing flows affect congestion?',
    sourceUrl: 'https://en.yna.co.kr/view/AEN20230113003700315', sourceName: 'Yonhap News Agency', visualizationType: 'alley',
  },
  {
    id: 'station', tab: 'The Station Fire', title: 'The Station Nightclub Fire', location: 'West Warwick, Rhode Island', date: 'February 20, 2003', fatalities: 100,
    description: 'A fire started during a concert and spread rapidly. Many people tried to leave through the main entrance, where crowding disrupted the evacuation.',
    safetyConcern: 'Too little usable exit capacity as the fire spread, alongside combustible materials and no sprinklers.',
    findings: ['Approximately two-thirds of occupants attempted to use the main entrance.', 'A crowd crush severely disrupted flow through the front exit before 90 seconds had elapsed.', '100 people died.'],
    planningQuestion: 'How do exit placement and crowd distribution affect evacuation time?',
    sourceUrl: 'https://www.nist.gov/disaster-failure-studies/station-nightclub-fire-2003', sourceName: 'National Institute of Standards and Technology', visualizationType: 'nightclub',
  },
]
