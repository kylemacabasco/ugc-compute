export interface Bounty {
  id: number;
  name: string;
  totalBounty: number;
  ratePer1kViews: number;
  description: string;
}

export const bounties: Bounty[] = [
  {
    id: 1,
    name: "Tech Product Review",
    totalBounty: 5000,
    ratePer1kViews: 2.5,
    description: "Create engaging reviews of the latest tech products. Must be authentic and detailed.",
  },
  {
    id: 2,
    name: "Fitness Challenge",
    totalBounty: 3000,
    ratePer1kViews: 1.8,
    description: "Share your fitness journey and motivate others with workout routines and tips.",
  },
  {
    id: 3,
    name: "Cooking Tutorial",
    totalBounty: 4000,
    ratePer1kViews: 2.0,
    description: "Teach viewers how to make delicious recipes with easy-to-follow instructions.",
  },
  {
    id: 4,
    name: "Travel Vlog",
    totalBounty: 6000,
    ratePer1kViews: 3.0,
    description: "Showcase amazing destinations and share travel tips with your audience.",
  },
  {
    id: 5,
    name: "DIY Crafts",
    totalBounty: 2500,
    ratePer1kViews: 1.5,
    description: "Create fun and creative DIY craft projects that viewers can replicate at home.",
  },
  {
    id: 6,
    name: "Gaming Highlights",
    totalBounty: 4500,
    ratePer1kViews: 2.2,
    description: "Share epic gaming moments, tutorials, and strategies for popular games.",
  },
];

