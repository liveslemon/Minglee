export const BUILD_VALUES = ["Slim", "Athletic", "Average", "Curvy"];

export const FOCUS_VALUES = [
  "Getting my degree and doing well",
  "Building a business/project on the side",
  "Balancing school and enjoying life",
  "Still figuring things out"
];

export const PHOTO_TYPE_VALUES = ["Profile", "Gallery"];

export const PROFILE_FIELD_RULES = {
  personal_style: {
    canonicalValues: ["Streetwear", "Minimal", "Casual", "Dressed Up"],
    aliases: {
      Minimalist: "Minimal"
    },
    frontendValues: {
      Streetwear: "Streetwear",
      Minimal: "Minimalist",
      Casual: "Casual",
      "Dressed Up": "Dressed Up"
    }
  },
  social_persona: {
    canonicalValues: ["Introverted", "Ambiverted", "Outgoing"],
    aliases: {
      Extroverted: "Outgoing"
    },
    frontendValues: {
      Introverted: "Introverted",
      Ambiverted: "Ambiverted",
      Outgoing: "Extroverted"
    }
  },
  weekend_type: {
    canonicalValues: ["Chill", "Out at the Bar", "Exploring new spots"],
    aliases: {
      "Chill in": "Chill"
    },
    frontendValues: {
      Chill: "Chill in",
      "Out at the Bar": "Out at the Bar",
      "Exploring new spots": "Exploring new spots"
    }
  },
  habits: {
    canonicalValues: ["Gym", "Skin Care", "Meditation", "Fast Food", "Productivity"],
    aliases: {
      "Gym Routine": "Gym"
    },
    frontendValues: {
      Gym: "Gym Routine",
      "Skin Care": "Skin Care",
      Meditation: "Meditation",
      "Fast Food": "Fast Food",
      Productivity: "Productivity"
    }
  },
  conflict_style: {
    canonicalValues: ["Talk it out", "Need space", "Let it blow over"],
    aliases: {
      "Talk it out immediately": "Talk it out",
      "Need space then talk": "Need space"
    },
    frontendValues: {
      "Talk it out": "Talk it out immediately",
      "Need space": "Need space then talk",
      "Let it blow over": "Let it blow over"
    }
  },
  green_flag: {
    canonicalValues: ["Kindness", "Ambition", "Emotional intelligence", "Clear communication", "Great sense of humor"],
    aliases: {
      "Kindness to others": "Kindness",
      "Ambition and drive": "Ambition"
    },
    frontendValues: {
      Kindness: "Kindness to others",
      Ambition: "Ambition and drive",
      "Emotional intelligence": "Emotional intelligence",
      "Clear communication": "Clear communication",
      "Great sense of humor": "Great sense of humor"
    }
  }
};

