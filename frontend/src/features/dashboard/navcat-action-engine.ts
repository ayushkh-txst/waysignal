import { citizenSafetyApi, type EvacuationRoute, type SafetyContext } from './api/citizen-safety.api';

export type NavCatIntent =
  | 'greeting'
  | 'capabilities'
  | 'thanks'
  | 'find_safe_location'
  | 'route_explanation'
  | 'route_update'
  | 'current_location'
  | 'risk'
  | 'weather'
  | 'responder_status'
  | 'emergency_number'
  | 'need_rescue'
  | 'medical_help'
  | 'panic_support'
  | 'route_blocked'
  | 'after_event'
  | 'feature_explanation'
  | 'out_of_scope'
  | 'unclear';

export type NavCatAction =
  | { kind: 'open_map'; label: string }
  | { kind: 'emergency_help'; label: string }
  | { kind: 'call'; label: string; phone: string };

export type NavCatActionResult = {
  intent: NavCatIntent;
  text: string;
  actions?: NavCatAction[];
  crisis?: boolean;
  route?: EvacuationRoute | null;
};

type PositionSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type NavCatContext = {
  userName: string;
  placeLabel: string;
  latestRoute: EvacuationRoute | null;
  latestSafety: SafetyContext | null;
  latestEmergencyStatus?: string | null;
  latestResponderName?: string | null;
  conversation?: Array<{ role: 'assistant' | 'user'; text: string }>;
};

const BLOCKED = /(road|way|route|path).*(block|closed|flood|water|tree|debris|can't pass|cannot pass)|block(ed|age)|can't go this way|cannot go this way/i;
const PANIC = /(scared|panic|afraid|terrified|shaking|overwhelmed|help me|dont know what to do|don't know what to do)/i;
const FEATURE_WORDS = /(map|live map|route|routing|safest route|risk|risk score|alert|alerts|assistant|navcat|emergency help|sos|responder|guidance|safe place|safe destination|weather|location|gps)/i;
const EXPLAIN_WORDS = /(how.*work|how does|how do|explain|what does|what is|what's|steps|understand|mean|why|tell me more|again|simpler|confused|don't get|dont get)/i;

function compact(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function gibberish(raw: string) {
  const value = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (value.length < 7) return false;
  const known = /(help|safe|route|road|risk|rain|weather|flood|water|river|location|where|map|responder|sos|medical|hurt|stuck|trapped|guide|shelter|blocked|emergency|police|ambulance|fire|work|explain)/.test(value);
  if (known) return false;
  const vowels = (value.match(/[aeiou]/g) || []).length;
  return vowels / value.length < 0.2 || /(.)\1\1/.test(value);
}

function lastTopic(context: NavCatContext) {
  const turns = context.conversation ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = turns[index].text.toLowerCase();
    if (/route|safe place|destination|map/.test(text)) return 'route';
    if (/risk|score/.test(text)) return 'risk';
    if (/weather|rain|river/.test(text)) return 'weather';
    if (/responder|sos|emergency help/.test(text)) return 'responder';
    if (/alert/.test(text)) return 'alerts';
    if (/navcat|assistant/.test(text)) return 'navcat';
  }
  return null;
}

function classify(input: string, context: NavCatContext): NavCatIntent {
  const raw = compact(input);
  const text = raw.toLowerCase();

  if (/^(hi|hello|hey|hiya|good morning|good afternoon|good evening)[!.,?\s]*$/i.test(raw)) return 'greeting';
  if (/what can you do|what do you do|who are you/i.test(text)) return 'capabilities';
  if (/^(thanks|thank you|thx|ty)[!.,?\s]*$/i.test(raw)) return 'thanks';
  if (/i'm safe now|i am safe now|we are safe|we're safe|it's over|it is over|rescued|after the flood/i.test(text)) return 'after_event';
  if (/(emergency|helpline|hotline|phone number|call).*(number|police|ambulance|fire|emergency)|^(911|100)$/i.test(text)) return 'emergency_number';
  if (/can't evacuate|cannot evacuate|need rescue|trapped|stuck|stranded/i.test(text)) return 'need_rescue';
  if (/medical|hurt|injured|bleeding|sick|ambulance/i.test(text)) return 'medical_help';
  if (BLOCKED.test(text)) return 'route_blocked';
  if (PANIC.test(text)) return 'panic_support';
  if (/where am i|my location|current location|locate me/i.test(text)) return 'current_location';
  if (/am i safe|my risk|risk right now|safe right now|flood risk/i.test(text)) return 'risk';
  if (/rain|raining|weather|forecast|dangerous rain/i.test(text)) return 'weather';
  if (/responder|sos|help.*way|response status|assigned responder/i.test(text)) return 'responder_status';
  if (/route changed|reroute|route update|changed midway|change my plan|still safe/i.test(text)) return 'route_update';
  if (/why.*route|explain.*route|why.*chosen|why this route/i.test(text)) return 'route_explanation';

  const followUp = /^(but )?how( does it)? work|explain (that|it) again|what do you mean|i don't understand|i dont understand|simpler|tell me more|show me how|walk me through/i.test(text);
  if ((FEATURE_WORDS.test(text) && EXPLAIN_WORDS.test(text)) || (followUp && lastTopic(context))) return 'feature_explanation';

  if (/(safe|safety|shelter|evacuat|destination|route|directions|navigate|way out|where.*go)/i.test(text) && /(find|take|guide|show|get|need|want|where|closest|nearest|best|safe|look)/i.test(text)) return 'find_safe_location';
  if (/write.*code|programming|homework|essay|stock|crypto|movie|game|recipe|celebrity|politics|math problem|dating|sports score|joke/i.test(text)) return 'out_of_scope';
  if (gibberish(raw)) return 'unclear';
  return 'unclear';
}

function position(): Promise<PositionSnapshot | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (result) => resolve({
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
      accuracy: Number.isFinite(result.coords.accuracy) ? result.coords.accuracy : null,
    }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 6500, maximumAge: 12000 },
  ));
}

const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(1, Math.round(meters))} m`;
const mins = (seconds: number) => Math.max(1, Math.round(seconds / 60));

function explainFeature(input: string, context: NavCatContext) {
  const text = input.toLowerCase();
  let topic: string | null = null;

  if (/route|safe place|destination|map/.test(text)) topic = 'route';
  else if (/risk|score/.test(text)) topic = 'risk';
  else if (/weather|rain|river/.test(text)) topic = 'weather';
  else if (/responder|sos|emergency help/.test(text)) topic = 'responder';
  else if (/alert/.test(text)) topic = 'alerts';
  else if (/navcat|assistant/.test(text)) topic = 'navcat';
  else topic = lastTopic(context);

  if (topic === 'route') {
    const route = context.latestRoute;
    if (route) {
      return `Here is how the safest-route feature works, step by step: 1) JalRakshak reads your current GPS position. 2) It finds nearby evacuation destinations. 3) It calculates real road routes to those destinations. 4) It checks the route options against the modeled hazard context. 5) Unsafe or unsuitable options are rejected. 6) The best remaining route is recommended. Your current recommendation is ${route.destination_name}. If your position or conditions change, ask me to recalculate and I can update the route.`;
    }
    return 'Here is how the safest-route feature works, step by step: 1) allow location access, 2) JalRakshak reads your GPS, 3) it finds nearby safe destinations, 4) it calculates real road routes, 5) it screens those routes for modeled hazards, and 6) it recommends the best remaining option. You can also just say “find me a safe place” and I can run that process for you.';
  }

  if (topic === 'risk') {
    return 'The risk score is a modeled estimate built from the environmental inputs available to JalRakshak, such as forecast rain and river conditions. It is not an official government warning. If you want, ask “explain my risk score” and I can walk through the current inputs one by one.';
  }

  if (topic === 'weather') {
    return 'The weather feature uses the live environmental context available to JalRakshak, including expected rainfall and related flood inputs. NavCat reads those backend values instead of inventing weather data.';
  }

  if (topic === 'responder') {
    return 'Emergency Help creates an SOS with your location and safety context. On the responder side, the request can be received, assigned, marked en route, handled on scene, and resolved. NavCat can report the latest recorded status without making one up.';
  }

  if (topic === 'alerts') {
    return 'Alerts are separated by source so you can tell what you are seeing: official warnings, JalRakshak modeled advisories, and system or route updates. If you are confused by one alert, tell me its name and I can explain it.';
  }

  return 'I’m NavCat, the safety assistant inside JalRakshak. I can explain any JalRakshak feature, guide you through a task step by step, check live safety context, find safer routes, and connect you to emergency help. GPS, routing, risk data, SOS records, and emergency contacts come from validated systems.';
}

function contact(latitude: number, longitude: number, text: string) {
  const inUnitedStates = latitude >= 24 && latitude <= 50 && longitude >= -125 && longitude <= -66;
  const inNepal = latitude >= 26 && latitude <= 31 && longitude >= 80 && longitude <= 89;

  if (inUnitedStates) {
    return {
      phone: '911',
      label: 'Call 911',
      description: 'In the United States, 911 connects police, fire, and emergency medical services.',
    };
  }

  if (inNepal && /police|emergency|help|number|hotline|helpline/i.test(text)) {
    return {
      phone: '100',
      label: 'Call Nepal Police 100',
      description: 'Nepal Police lists Police Control 100 as an emergency contact number.',
    };
  }

  return null;
}

async function safety(snapshot: PositionSnapshot) {
  try {
    return await citizenSafetyApi.getContext(snapshot.latitude, snapshot.longitude);
  } catch {
    return null;
  }
}

async function route(snapshot: PositionSnapshot) {
  try {
    return await citizenSafetyApi.getEvacuationRoute(snapshot.latitude, snapshot.longitude);
  } catch {
    return null;
  }
}

export async function runNavCatAction(input: string, context: NavCatContext): Promise<NavCatActionResult> {
  const intent = classify(input, context);
  const name = context.userName || 'there';

  if (intent === 'greeting') {
    return { intent, text: `Hello ${name}. How can I help you today?` };
  }

  if (intent === 'capabilities') {
    return {
      intent,
      text: 'I’m NavCat, JalRakshak’s safety assistant. I can explain any JalRakshak feature, guide you through it step by step, check live flood context, find a safe destination, calculate and explain routes, check responder status, and connect you to emergency help.',
    };
  }

  if (intent === 'thanks') {
    return { intent, text: `You’re welcome, ${name}. Ask me anything else about JalRakshak or your current safety situation.` };
  }

  if (intent === 'feature_explanation') {
    return { intent, text: explainFeature(input, context) };
  }

  if (intent === 'out_of_scope') {
    return {
      intent,
      text: 'Sorry, that is outside my scope. I’m focused on JalRakshak, flood safety, evacuation, weather and risk context, routes, safe locations, and emergency response.',
    };
  }

  if (intent === 'unclear') {
    return {
      intent,
      text: `I’m not sure what you mean, ${name}. If you are asking about something in JalRakshak, describe the feature in your own words and I’ll explain it. If this is a safety situation, even short phrases like “road blocked” or “need help” are enough.`,
    };
  }

  if (intent === 'after_event') {
    return {
      intent,
      text: `I’m glad you reached a safer point, ${name}. Stay somewhere safe, check whether anyone with you needs help, and keep an eye on official updates. I can still explain anything in JalRakshak or check weather, routes, and responder status.`,
    };
  }

  if (intent === 'need_rescue') {
    return {
      intent,
      crisis: true,
      text: 'If moving would put you in more danger, stay where you are. I can open Emergency Help so your location and safety context can be attached to an SOS.',
      actions: [{ kind: 'emergency_help', label: 'Open Emergency Help' }],
    };
  }

  if (intent === 'medical_help') {
    return {
      intent,
      crisis: true,
      text: 'I can take you directly to Emergency Help for medical assistance and attach your current location.',
      actions: [{ kind: 'emergency_help', label: 'Request medical help' }],
    };
  }

  if (intent === 'panic_support') {
    return {
      intent,
      crisis: true,
      text: context.latestRoute
        ? `I’m here with you, ${name}. Your current destination is ${context.latestRoute.destination_name}, about ${mins(context.latestRoute.duration_s)} minutes away. I can keep the route visible and help you one step at a time.`
        : `I’m here with you, ${name}. You do not need to explain everything perfectly. I can find a safe destination from your current location and guide you one step at a time.`,
      actions: [{ kind: 'open_map', label: context.latestRoute ? 'Open current route' : 'Find a safe route' }],
    };
  }

  const currentPosition = await position();

  if (intent === 'emergency_number') {
    if (!currentPosition) {
      return { intent, text: 'I need your location to give the correct regional emergency number. Allow location access, or tell me your country.' };
    }
    const emergencyContact = contact(currentPosition.latitude, currentPosition.longitude, input);
    return emergencyContact
      ? {
          intent,
          text: emergencyContact.description,
          actions: [{ kind: 'call', label: emergencyContact.label, phone: emergencyContact.phone }],
        }
      : {
          intent,
          text: 'I do not have a verified emergency number for this region in the current directory, so I will not guess one.',
          actions: [{ kind: 'emergency_help', label: 'Open Emergency Help' }],
        };
  }

  if (intent === 'current_location') {
    return currentPosition
      ? {
          intent,
          text: `I have your current GPS position${currentPosition.accuracy ? ` with about ±${Math.round(currentPosition.accuracy)} m accuracy` : ''}. I can use it to calculate a route.`,
          actions: [{ kind: 'open_map', label: 'Show on Live Map' }],
        }
      : { intent, text: 'I could not access your location. Enable location permission and ask me again.' };
  }

  if (intent === 'find_safe_location' || intent === 'route_blocked') {
    if (!currentPosition) {
      return {
        intent,
        crisis: intent === 'route_blocked',
        text: 'I need your current location to calculate a safe route. Enable location permission and ask again.',
      };
    }

    const [nextRoute, nextSafety] = await Promise.all([route(currentPosition), safety(currentPosition)]);

    if (!nextRoute) {
      return {
        intent,
        crisis: intent === 'route_blocked',
        text: 'I could not calculate a new route right now, so I will not invent one. Open Live Map to keep the last successful route visible.',
        actions: [{ kind: 'open_map', label: 'Open Live Map' }],
      };
    }

    if (nextRoute.screening_status !== 'complete' || nextRoute.recommended_count === 0) {
      return { intent, crisis: intent === 'route_blocked', route: nextRoute,
        text: nextRoute.screening_status === 'complete'
          ? 'No road alternative passed the current hazard screen. No route is recommended.'
          : 'Shared hazard screening is unavailable. I cannot recommend a route until it can be checked.',
        actions: [{ kind: 'open_map', label: 'Review Live Map' }] };
    }

    const screening = nextRoute.screening_status === 'complete'
      ? `${nextRoute.alternatives_considered} routes analyzed · ${nextRoute.rejected_count ?? 0} rejected · ${nextRoute.viable_count ?? 0} viable.`
      : `${nextRoute.alternatives_considered} route options considered.`;

    return {
      intent,
      crisis: intent === 'route_blocked',
      route: nextRoute,
      text: `${intent === 'route_blocked' ? 'I recalculated from your current position. ' : ''}Best current destination: ${nextRoute.destination_name}. ETA about ${mins(nextRoute.duration_s)} min · ${distance(nextRoute.distance_m)}. ${screening}${nextSafety ? ` Current modeled flood risk is ${nextSafety.prototype_risk_level.toUpperCase()} (${nextSafety.prototype_risk_score}/100).` : ''}`,
      actions: [{ kind: 'open_map', label: intent === 'route_blocked' ? 'Open new route' : 'Open route' }],
    };
  }

  if (intent === 'risk' || intent === 'weather') {
    if (!currentPosition) {
      return { intent, text: 'I need your location to check the live environmental context.' };
    }

    const nextSafety = await safety(currentPosition);
    if (!nextSafety) {
      return { intent, text: 'Live environmental data is temporarily unavailable. I will not guess.' };
    }

    if (intent === 'weather') {
      return {
        intent,
        text: `The current feed shows ${nextSafety.precipitation_next_6h_mm.toFixed(1)} mm of rain over the next 6 hours${nextSafety.precipitation_probability_max_6h == null ? '' : ` with up to ${nextSafety.precipitation_probability_max_6h}% probability`}.`,
      };
    }

    return {
      intent,
      text: `Your current JalRakshak model is ${nextSafety.prototype_risk_level.toUpperCase()} at ${nextSafety.prototype_risk_score}/100. This is modeled context, not an official warning.`,
    };
  }

  if (intent === 'route_explanation') {
    const currentRoute = context.latestRoute;
    if (!currentRoute) {
      return { intent, text: explainFeature('how does safest route work', context) };
    }

    return {
      intent,
      text: `JalRakshak considered ${currentRoute.alternatives_considered} route options. ${currentRoute.screening_status === 'complete' ? `${currentRoute.rejected_count ?? 0} were rejected and ${currentRoute.viable_count ?? 0} remained viable. ` : ''}It recommends ${currentRoute.destination_name}. The system uses your GPS, real-road routing, destination candidates, and modeled hazard screening. If you want, I can explain those steps one at a time.`,
      actions: [{ kind: 'open_map', label: 'View route analysis' }],
    };
  }

  if (intent === 'route_update') {
    if (!currentPosition) {
      return { intent, text: 'I need your current location to verify whether the route should change.' };
    }

    const nextRoute = await route(currentPosition);
    return nextRoute
      ? {
          intent,
          route: nextRoute,
          text: `I checked again. The latest recommendation is ${nextRoute.destination_name}, about ${mins(nextRoute.duration_s)} min · ${distance(nextRoute.distance_m)}.`,
          actions: [{ kind: 'open_map', label: 'Open latest route' }],
        }
      : {
          intent,
          text: 'I could not verify a new route, so I will not claim the old route is still safe.',
          actions: [{ kind: 'open_map', label: 'Open Live Map' }],
        };
  }

  if (intent === 'responder_status') {
    if (!context.latestEmergencyStatus) {
      return {
        intent,
        text: 'I do not see an active responder assignment right now. If you need immediate help, I can open Emergency Help.',
        actions: [{ kind: 'emergency_help', label: 'Open Emergency Help' }],
      };
    }

    const responder = context.latestResponderName ? ` ${context.latestResponderName} is assigned.` : '';
    return {
      intent,
      text: `Your latest SOS status is ${context.latestEmergencyStatus.replace(/_/g, ' ')}.${responder}`,
    };
  }

  return {
    intent: 'unclear',
    text: `I’m not sure what you mean, ${name}. Tell me what part of JalRakshak you are trying to use and I can explain or guide you through it.`,
  };
}
