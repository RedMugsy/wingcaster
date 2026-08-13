/** Exhaustive amenity catalog for Lebanon residential / rental listings. */

export type AmenityCategory = {
  id: string
  label: string
  items: string[]
  /** Emphasize when listing type is rent */
  rentFocus?: boolean
}

export const AMENITY_CATEGORIES: AmenityCategory[] = [
  {
    id: 'outdoor',
    label: 'Outdoor & leisure',
    rentFocus: true,
    items: [
      'Swimming Pool',
      'Private Pool',
      'Shared Pool',
      'Infinity Pool',
      'Garden',
      'Private Garden',
      'Shared Garden',
      'Terrace',
      'Balcony',
      'Roof Terrace',
      'Outdoor Kitchen',
      'BBQ Area',
      'Private Beach Access',
      'Sea View',
      'Mountain View',
      'City View',
      'Playground',
      'Sports Court',
      'Jacuzzi',
      'Sauna',
      'Steam Room',
    ],
  },
  {
    id: 'climate',
    label: 'Climate & utilities',
    rentFocus: true,
    items: [
      'Central Airconditioning',
      'Split Airconditioning',
      'Heating',
      'Underfloor Heating',
      'Fireplace',
      'Solar Water Heating',
      'Double Glazing',
      'Generator',
      'Private Generator',
      'Building Generator',
      'Water Tank',
      'Solar Panels',
      'Smart Home',
    ],
  },
  {
    id: 'rooms',
    label: 'Rooms & spaces',
    rentFocus: true,
    items: [
      'Maids Room',
      'Guard / Driver Room',
      'Storage',
      'Built-in Wardrobes',
      'Walk-in Closet',
      'Laundry Room',
      'Study / Office',
      'Family Room',
      'Dining Room',
      'Reception Area',
      'Guest Bathroom',
      'En-suite Bathroom',
      'Powder Room',
      'Basement',
      'Attic',
      'Wine Cellar',
      'Home Cinema',
      'Server Room',
    ],
  },
  {
    id: 'parking',
    label: 'Parking & access',
    rentFocus: true,
    items: [
      'Covered Parking',
      'Uncovered Parking',
      'Private Parking',
      'Shared Parking',
      'Garage',
      'Valet Parking',
      'EV Charging',
      'Elevator',
      'Private Elevator',
      'Wheelchair Access',
      'Service Entrance',
    ],
  },
  {
    id: 'security',
    label: 'Security & building',
    rentFocus: true,
    items: [
      'Security',
      '24/7 Security',
      'Concierge',
      'Doorman',
      'CCTV',
      'Gated Community',
      'Intercom',
      'Alarm System',
      'Fire Safety System',
      'Building Management',
    ],
  },
  {
    id: 'fitness',
    label: 'Fitness & wellness',
    items: [
      'Shared Gym',
      'Private Gym',
      'Spa',
      'Yoga Room',
      'Kids Play Area',
    ],
  },
  {
    id: 'kitchen',
    label: 'Kitchen & appliances',
    rentFocus: true,
    items: [
      'Fully Equipped Kitchen',
      'Open Kitchen',
      'Kitchen Appliances',
      'Dishwasher',
      'Washing Machine',
      'Dryer',
      'Microwave',
      'Refrigerator',
    ],
  },
  {
    id: 'furnishing',
    label: 'Furnishing & finishes',
    rentFocus: true,
    items: [
      'Furnished',
      'Semi-Furnished',
      'Unfurnished',
      'Luxury Finishes',
      'Marble Floors',
      'Hardwood Floors',
      'Tile Floors',
      'High Ceilings',
      'Floor-to-Ceiling Windows',
      'Built-in Speakers',
    ],
  },
  {
    id: 'services',
    label: 'Services & connectivity',
    rentFocus: true,
    items: [
      'Internet / Fiber',
      'Satellite / Cable Ready',
      'Phone Line',
      'Pets Allowed',
      'Pet Friendly',
      'Near Schools',
      'Near Hospitals',
      'Near Metro / Bus',
      'Near Shopping',
      'Maintenance Included',
      'Building Fees Included',
    ],
  },
  {
    id: 'commercial',
    label: 'Commercial extras',
    items: [
      'Reception Desk',
      'Meeting Rooms',
      'Pantry',
      'Loading Bay',
      'Shop Front',
      'Signage Rights',
    ],
  },
]

export const ALL_AMENITIES = Array.from(
  new Set(AMENITY_CATEGORIES.flatMap((c) => c.items))
)

export const MEDIA_CLASSIFICATIONS = [
  'Exterior / Facade',
  'Living Room',
  'Dining Room',
  'Kitchen',
  'Master Bedroom',
  'Bedroom',
  'Bathroom',
  'Balcony / Terrace',
  'Garden',
  'Pool',
  'Parking / Garage',
  'Lobby / Entrance',
  'View',
  'Floor Plan',
  'Drone / Aerial',
  'Video Tour',
  'Building Amenities',
  'Neighborhood',
  'Other',
] as const

export const MAX_LISTING_MEDIA = 15

export type ListingMediaItem = {
  id: string
  url: string
  media_type: 'image' | 'video'
  classification: string
  source: 'link' | 'upload'
}
