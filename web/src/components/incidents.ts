export type VisualizationType = 'concert' | 'alley' | 'nightclub' | 'stadium'
export type Incident = {
  id: string; tab: string; title: string; location: string; date: string; fatalities: number
  description: string; safetyConcern: string; planningQuestion: string
  sourceUrl: string; sourceName: string; visualizationType: VisualizationType; findings?: string[]
}

export const incidents: Incident[] = [
  {
    id: 'astroworld', tab: 'Astroworld', title: 'Astroworld Festival', location: 'Houston, Texas', date: 'November 5, 2021', fatalities: 10,
    description: 'During Travis Scott’s performance at the Astroworld Festival, severe crowd compression developed in a densely packed audience. Ten people died from compression asphyxia.',
    safetyConcern: 'High crowd density, constrained movement, and pressure around concert barriers.',
    planningQuestion: 'How might crowd distribution, barrier configurations, and access routes influence dangerous congestion?',
    sourceUrl: 'https://toronto.citynews.ca/2021/12/16/officials-astroworld-victims-died-from-compression-asphyxia/', sourceName: 'Associated Press / CityNews', visualizationType: 'concert',
  },
  {
    id: 'itaewon', tab: 'Itaewon', title: 'Itaewon Crowd Crush', location: 'Seoul, South Korea', date: 'October 29, 2022', fatalities: 159,
    description: 'During Halloween celebrations in Seoul’s Itaewon district, extreme crowd congestion developed in a narrow, sloping alley. Investigators identified failures in preventive planning and emergency response.',
    safetyConcern: 'High pedestrian density, constrained passageways, and inadequate crowd-management precautions.',
    planningQuestion: 'How can narrow passages, pedestrian volume, and opposing flows create dangerous bottlenecks?',
    sourceUrl: 'https://en.yna.co.kr/view/AEN20230113003700315', sourceName: 'Yonhap News Agency', visualizationType: 'alley',
  },
  {
    id: 'station', tab: 'The Station Fire', title: 'The Station Nightclub Fire', location: 'West Warwick, Rhode Island', date: 'February 20, 2003', fatalities: 100,
    description: 'A fire ignited during a concert at The Station nightclub and spread rapidly. Many occupants attempted to escape through the main entrance, where severe congestion disrupted evacuation.',
    safetyConcern: 'Insufficient effective exit capacity during a rapidly developing fire, compounded by combustible materials and the absence of sprinklers.',
    findings: ['Approximately two-thirds of occupants attempted to use the main entrance.', 'A crowd crush severely disrupted flow through the front exit before 90 seconds had elapsed.', '100 people died.'],
    planningQuestion: 'How could different exit arrangements, crowd distributions, and evacuation routes affect the time needed to reach safety?',
    sourceUrl: 'https://www.nist.gov/disaster-failure-studies/station-nightclub-fire-2003', sourceName: 'National Institute of Standards and Technology', visualizationType: 'nightclub',
  },
  {
    id: 'hillsborough', tab: 'Hillsborough', title: 'Hillsborough Disaster', location: 'Sheffield, United Kingdom', date: 'April 15, 1989', fatalities: 97,
    description: 'A fatal crowd crush developed in the standing terraces during an FA Cup semi-final. Official investigations found serious failures in crowd control, stadium safety, and emergency arrangements. Supporters were not responsible for the disaster.',
    safetyConcern: 'Unsafe crowd distribution, inadequate access arrangements, and insufficient emergency exit capacity.',
    planningQuestion: 'How can entrance management, section capacity, and crowd distribution affect safety in large venues?',
    sourceUrl: 'https://www.policeconduct.gov.uk/our-work/investigations/hillsborough', sourceName: 'Independent Office for Police Conduct', visualizationType: 'stadium',
  },
]
