// Local shape definitions — see src/types/Shemastructure/ for the
// canonical schemas, which are intentionally not imported here.
interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface Feature {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface Flow {
  id: string;
  projectId: string;
  featureId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Hardcoded demo user
export const seedUser: User = {
  id: "user-1",
  name: "Demo User",
  email: "demo@example.com",
  createdAt: "2024-01-15T10:00:00.000Z",
  updatedAt: "2024-01-15T10:00:00.000Z",
};

export const seedProjects: Project[] = [
  {
    id: "proj-1",
    userId: "user-1",
    name: "E-commerce Platform",
    createdAt: "2024-08-01T09:00:00.000Z",
    updatedAt: "2024-08-25T14:30:00.000Z",
  },
  {
    id: "proj-2",
    userId: "user-1",
    name: "Mobile App",
    createdAt: "2024-08-10T11:00:00.000Z",
    updatedAt: "2024-08-28T16:00:00.000Z",
  },
];

export const seedFeatures: Feature[] = [
  // E-commerce Platform
  {
    id: "feat-1",
    projectId: "proj-1",
    name: "Authentication",
    createdAt: "2024-08-02T09:00:00.000Z",
    updatedAt: "2024-08-02T09:00:00.000Z",
  },
  {
    id: "feat-2",
    projectId: "proj-1",
    name: "Shopping Cart",
    createdAt: "2024-08-05T10:00:00.000Z",
    updatedAt: "2024-08-05T10:00:00.000Z",
  },
  {
    id: "feat-3",
    projectId: "proj-1",
    name: "Checkout",
    createdAt: "2024-08-08T11:00:00.000Z",
    updatedAt: "2024-08-08T11:00:00.000Z",
  },
  // Mobile App
  {
    id: "feat-4",
    projectId: "proj-2",
    name: "Onboarding",
    createdAt: "2024-08-11T09:00:00.000Z",
    updatedAt: "2024-08-11T09:00:00.000Z",
  },
  {
    id: "feat-5",
    projectId: "proj-2",
    name: "Profile",
    createdAt: "2024-08-12T10:00:00.000Z",
    updatedAt: "2024-08-12T10:00:00.000Z",
  },
];

export const seedFlows: Flow[] = [
  // Authentication
  {
    id: "flow-1",
    projectId: "proj-1",
    featureId: "feat-1",
    name: "User Login Flow",
    createdAt: "2024-08-03T09:00:00.000Z",
    updatedAt: "2024-08-03T09:00:00.000Z",
  },
  {
    id: "flow-2",
    projectId: "proj-1",
    featureId: "feat-1",
    name: "Forgot Password Flow",
    createdAt: "2024-08-04T10:00:00.000Z",
    updatedAt: "2024-08-04T10:00:00.000Z",
  },
  // Cart
  {
    id: "flow-3",
    projectId: "proj-1",
    featureId: "feat-2",
    name: "Add to Cart Flow",
    createdAt: "2024-08-06T09:00:00.000Z",
    updatedAt: "2024-08-06T09:00:00.000Z",
  },
  {
    id: "flow-4",
    projectId: "proj-1",
    featureId: "feat-2",
    name: "Remove from Cart Flow",
    createdAt: "2024-08-07T10:00:00.000Z",
    updatedAt: "2024-08-07T10:00:00.000Z",
  },
  // Checkout
  {
    id: "flow-5",
    projectId: "proj-1",
    featureId: "feat-3",
    name: "Payment Flow",
    createdAt: "2024-08-09T11:00:00.000Z",
    updatedAt: "2024-08-09T11:00:00.000Z",
  },
  // Onboarding
  {
    id: "flow-6",
    projectId: "proj-2",
    featureId: "feat-4",
    name: "Welcome Screen Flow",
    createdAt: "2024-08-13T09:00:00.000Z",
    updatedAt: "2024-08-13T09:00:00.000Z",
  },
  // Profile
  {
    id: "flow-7",
    projectId: "proj-2",
    featureId: "feat-5",
    name: "Edit Profile Flow",
    createdAt: "2024-08-14T10:00:00.000Z",
    updatedAt: "2024-08-14T10:00:00.000Z",
  },
  {
    id: "flow-8",
    projectId: "proj-2",
    featureId: "feat-5",
    name: "Change Avatar Flow",
    createdAt: "2024-08-15T11:00:00.000Z",
    updatedAt: "2024-08-15T11:00:00.000Z",
  },
];