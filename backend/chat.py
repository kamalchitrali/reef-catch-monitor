"""Context-aware, deterministic chat for catch records and field guidance.

The assistant deliberately answers only from the user's records and the app's
bounded fisheries guidance. It does not pretend to be a general-purpose model.
"""

from collections import Counter
from datetime import date
import re

from .conservation import conservation_answer, conservation_topic, conservation_welcome


RECORD_INTENTS = {"totals", "species", "sites", "habitats", "lengths", "weights", "recent", "data_quality"}
CONSERVATION_INTENTS = {
    "protected_species", "bycatch", "habitat_health", "climate", "pollution", "mpa", "sustainable_fishing", "monitoring",
}


def _normalized(message: str) -> str:
    return re.sub(r"[^\w\s'.-]+", " ", message.casefold()).strip()


def conversational_intent(message: str) -> str | None:
    text = _normalized(message)
    words = set(text.split())
    compact = text.replace(" ", "")
    if words & {"thank", "thanks", "thx"} or "thank you" in text or "thank u" in text or compact.startswith("thankyou") or text == "ty":
        return "thanks"
    if words & {"bye", "goodbye"} or any(phrase in text for phrase in ("see you", "talk later", "good night")):
        return "goodbye"
    if any(phrase in text for phrase in ("how are you", "how's it going", "hows it going")):
        return "smalltalk"
    if text in {"ok", "okay", "great", "cool", "got it", "understood", "sounds good", "alright", "perfect"}:
        return "affirmation"
    if (words and len(words) <= 4 and text.split()[0] in {"hi", "hello", "hey", "hiya"}) or text in {"good morning", "good afternoon", "good evening"}:
        return "greeting"
    if any(phrase in text for phrase in ("what can you do", "how can you help", "can you help me", "who are you")):
        return "capabilities"
    return None


def context_intent(history: list[dict | str]) -> str | None:
    for item in reversed(history):
        if isinstance(item, dict) and item.get("intent") and item.get("role") == "assistant":
            intent = str(item["intent"])
            if intent not in {"help", "thanks", "affirmation", "greeting", "goodbye", "smalltalk"}:
                return intent
    for item in reversed(history):
        content = item if isinstance(item, str) else item.get("content", "")
        if content:
            intent = detect_intent(str(content))
            if intent not in {"help", "thanks", "affirmation", "greeting", "goodbye"}:
                return intent
    return None


def detect_intent(message: str, previous_intent: str | None = None) -> str:
    text = _normalized(message)
    social = conversational_intent(message)
    if social:
        return social

    if any(phrase in text for phrase in ("not working", "doesn't work", "does not work", "failed", "error", "stuck", "can't upload", "cannot upload")):
        return "troubleshooting"
    conservation = conservation_topic(message)
    if conservation:
        return conservation
    if "train" in text or "model" in text or "dataset" in text:
        return "model"
    if "weight" in text or "weigh" in text or "heaviest" in text or "biomass" in text:
        return "weights"
    if any(word in text for word in ("latest", "recent", "newest", "last catch")) or "when did i" in text:
        return "recent"
    if any(phrase in text for phrase in ("missing data", "data quality", "complete are", "needs review", "unknown species")):
        return "data_quality"
    if "species" in text or any(phrase in text for phrase in ("kind of fish", "kinds of fish", "type of fish", "types of fish", "fish labels")):
        return "species"
    if "site" in text or "location" in text or any(phrase in text for phrase in ("where did i", "where have i", "places i sampled", "sampling places")):
        return "sites"
    if "habitat" in text or "environment" in text or "freshwater" in text or "marine" in text or "brackish" in text:
        return "habitats"
    if any(word in text for word in ("length", "longest", "average", "mean", "biggest", "smallest", "shortest")):
        return "lengths"
    if any(word in text for word in ("how many", "total", "count", "number of", "specimen")) or (
        any(word in text for word in ("catch", "catches", "fish")) and any(word in text for word in ("saved", "recorded", "have any", "do i have"))
    ):
        return "totals"
    if any(word in text for word in ("record", "add", "upload", "measure", "photo", "photograph", "ruler", "calibrat", "crop", "save")):
        return "guidance"

    follow_up = text.startswith(("and ", "what about", "tell me more", "why", "how so", "what else", "explain")) or text in {
        "more", "why", "how", "what about that", "tell me more about that",
    }
    if follow_up and previous_intent:
        return previous_intent
    return "help"


def _stats(catches: list[dict]) -> dict:
    fish = [item for catch in catches for item in catch.get("specimens", [])]
    research = [catch for catch in catches if not catch.get("demo")]
    labels = [item.get("species") or "Unknown" for item in fish]
    measured = [float(item["measured_cm"]) for item in fish if item.get("measured_cm") is not None]
    estimated = [float(item["estimated_cm"]) for item in fish if item.get("estimated_cm") is not None]
    weights = [float(item["weight_g"]) for item in fish if item.get("weight_g") is not None]
    return {
        "fish": fish,
        "species": Counter(labels),
        "sites": Counter(catch.get("site") or "Unknown" for catch in catches),
        "habitats": Counter(catch.get("habitat") or "Unspecified" for catch in catches),
        "measured": measured,
        "estimated": estimated,
        "weights": weights,
        "research": research,
    }


def _matched_counter_item(message: str, values: Counter) -> str | None:
    text = _normalized(message)
    matches = [name for name in values if name.casefold() != "unknown" and name.casefold() in text]
    return max(matches, key=len) if matches else None


def answer(message: str, catches: list[dict], intent: str, previous_intent: str | None = None) -> str:
    stats = _stats(catches)
    fish = stats["fish"]

    if intent == "thanks":
        return "You’re welcome. What would you like to explore next?"
    if intent == "goodbye":
        return "Goodbye! Your catch records will be here when you return."
    if intent == "smalltalk":
        return "I’m doing well and ready to help. How is your fieldwork going?"
    if intent == "affirmation":
        return "Great—what should we look at next?"
    if intent == "greeting":
        return "Hello! I’m Reef. Ask me naturally about your catches, measurements, species, sites, or conservation monitoring."
    if intent == "capabilities":
        return ("I can summarize your private catch records, compare species, sites, habitats, lengths, and weights, check missing data, "
                "guide you through photo measurement, and discuss fisheries-conservation monitoring. I’ll tell you when an answer comes from "
                "your records and when it is general guidance.")
    if intent == "troubleshooting":
        return ("I can help troubleshoot it. Which step is failing: signing in, uploading a photo, placing ruler or fish markers, saving a catch, "
                "or training the species model? Include the exact message you see, if there is one.")
    if intent in CONSERVATION_INTENTS:
        return conservation_answer(intent, catches)
    if intent == "model":
        return ("For a reliable species model, use reviewed fish crops with image, species, collection group, and split columns. Keep every "
                "image from the same trip or specimen group in only one split, include at least two training images per species, and evaluate "
                "on independent groups. Open Model performance after training to review errors and low-confidence cases.")
    if intent == "guidance":
        text = _normalized(message)
        if "ruler" in text or "calibrat" in text or "measure" in text:
            return ("Upload the photo, mark two points across a known ruler span, enter that span in centimeters, then mark the fish from snout "
                    "to the farthest tail tip. Confirm the ruler and fish are in the same plane. You can drag either numbered marker to correct it.")
        if "crop" in text:
            return ("Choose Fish crop and mark opposite corners around the whole fish, leaving a small margin around fins and tail. You can also "
                    "use Create crop around fish, then drag the corner handles to refine it.")
        if "photo" in text or "upload" in text or "photograph" in text:
            return ("Use a clear overhead JPEG, PNG, or WebP with the entire fish and ruler visible. Avoid glare and strong shadows. The app accepts "
                    "photos up to 12 MB and keeps quality messages advisory so you can still work with field images.")
        return ("Open New catch analysis, upload a photo, complete the ruler, fish-size, and optional crop markers, review the species and field "
                "details, then select Save catch record. Tell me which step you want help with and I’ll walk through it.")
    if intent == "totals":
        if not catches:
            return "You currently have 0 saved catch records and 0 fish. Uploading a photo does not save it until you select Save catch record."
        demo_count = sum(bool(catch.get("demo")) for catch in catches)
        suffix = f" {demo_count} of those {'is' if demo_count == 1 else 'are'} marked as demonstration data." if demo_count else ""
        return f"You have {len(catches)} saved catch record{'s' if len(catches) != 1 else ''} containing {len(fish)} fish in total.{suffix}"
    if intent == "species":
        species = stats["species"]
        if not species:
            return "There are no saved species labels yet. You can save a fish as Unknown and review the label later."
        matched = _matched_counter_item(message, species)
        if matched:
            count = species[matched]
            return f"Yes—{matched} appears on {count} saved specimen{'s' if count != 1 else ''}." if count else f"I could not find {matched} in your saved records."
        reviewed = Counter({name: count for name, count in species.items() if "unknown" not in name.casefold()})
        unknown = sum(count for name, count in species.items() if "unknown" in name.casefold())
        if not reviewed:
            return f"All {len(fish)} saved specimen{'s' if len(fish) != 1 else ''} still need a reviewed species label."
        ranking = ", ".join(f"{name} ({count})" for name, count in reviewed.most_common(5))
        tail = f" {unknown} specimen{'s' if unknown != 1 else ''} still need review." if unknown else ""
        return f"Your most common reviewed species are {ranking}. You have {len(reviewed)} distinct reviewed label{'s' if len(reviewed) != 1 else ''}.{tail}"
    if intent == "sites":
        sites = stats["sites"]
        if not sites:
            return "You do not have any saved collection sites yet."
        matched = _matched_counter_item(message, sites)
        if matched:
            records = [catch for catch in catches if (catch.get("site") or "Unknown") == matched]
            specimens = sum(len(catch.get("specimens", [])) for catch in records)
            return f"At {matched}, you have {len(records)} catch record{'s' if len(records) != 1 else ''} containing {specimens} fish."
        return "Your catch sites are " + ", ".join(f"{name} ({count})" for name, count in sites.most_common(8)) + "."
    if intent == "habitats":
        habitats = stats["habitats"]
        if not habitats:
            return "You do not have any saved habitat information yet."
        return "Your habitat breakdown is " + ", ".join(f"{name} ({count})" for name, count in habitats.most_common()) + "."
    if intent == "lengths":
        values = stats["measured"] or stats["estimated"]
        source = "physical measurements" if stats["measured"] else "calibrated photo estimates"
        if not values:
            return "There are no fish lengths in your saved records yet. Add a physical length or save a valid ruler calibration and fish endpoints."
        return (f"From {len(values)} {source}, the average length is {sum(values) / len(values):.2f} cm, the shortest is {min(values):.2f} cm, "
                f"and the longest is {max(values):.2f} cm.")
    if intent == "weights":
        weights = stats["weights"]
        if not weights:
            return "There are no measured weights in your saved records yet. Weight is optional and must be entered from a physical scale."
        return (f"You have {len(weights)} measured weight{'s' if len(weights) != 1 else ''}. Their total is {sum(weights):,.1f} g, the average is "
                f"{sum(weights) / len(weights):,.1f} g, and the heaviest is {max(weights):,.1f} g.")
    if intent == "recent":
        if not catches:
            return "You do not have a saved catch yet."
        def parsed(catch):
            try:
                return date.fromisoformat(str(catch.get("collected_on", "")))
            except (TypeError, ValueError):
                return date.min
        latest = max(catches, key=parsed)
        count = len(latest.get("specimens", []))
        return f"Your latest collection date is {latest.get('collected_on', 'unknown')} at {latest.get('site') or 'an unspecified site'}, with {count} fish."
    if intent == "data_quality":
        if not catches:
            return "There are no saved records to check yet."
        unknown = sum(1 for item in fish if "unknown" in (item.get("species") or "unknown").casefold())
        no_length = sum(1 for item in fish if item.get("measured_cm") is None and item.get("estimated_cm") is None)
        no_habitat = sum(1 for catch in catches if not catch.get("habitat"))
        demo = len(catches) - len(stats["research"])
        return (f"Data-quality check: {unknown} specimen{'s' if unknown != 1 else ''} need a species review, {no_length} lack a saved length, "
                f"{no_habitat} catch record{'s' if no_habitat != 1 else ''} lack habitat, and {demo} record{'s are' if demo != 1 else ' is'} marked as demonstration data.")

    if previous_intent and previous_intent in CONSERVATION_INTENTS:
        return conservation_answer(previous_intent, catches)
    return ("I’m not sure which part you mean yet. Are you asking about your saved records, measuring a photo, identifying a species, training "
            "the model, or planning conservation monitoring?")


def metadata(intent: str) -> tuple[str, list[str]]:
    activities = {
        "greeting": "Preparing a welcome…", "thanks": "Responding…", "goodbye": "Wrapping up…",
        "smalltalk": "Responding…", "affirmation": "Continuing…", "capabilities": "Summarizing how I can help…",
        "troubleshooting": "Narrowing down the problem…", "model": "Reviewing model guidance…",
        "species": "Reviewing species labels…", "sites": "Comparing collection sites…",
        "habitats": "Summarizing habitats…", "lengths": "Calculating saved lengths…",
        "weights": "Calculating saved weights…", "totals": "Counting catches and specimens…",
        "recent": "Checking collection dates…", "data_quality": "Checking record completeness…",
        "guidance": "Reviewing the analysis workflow…", "protected_species": "Reviewing protected-species guidance…",
        "bycatch": "Reviewing bycatch guidance…", "habitat_health": "Reviewing aquatic-habitat guidance…",
        "climate": "Reviewing climate-monitoring guidance…", "pollution": "Reviewing pollution guidance…",
        "mpa": "Reviewing protected-area study design…", "sustainable_fishing": "Reviewing sustainable-fisheries guidance…",
        "monitoring": "Building a monitoring answer…", "help": "Understanding your question…",
    }
    prompts = {
        "greeting": ["What can you help me with?", "Check my record quality"],
        "capabilities": ["Summarize my catches", "Check my record quality"],
        "thanks": [], "smalltalk": ["What can you help me with?"],
        "affirmation": ["Check my record quality", "How can catch data support conservation?"],
        "troubleshooting": ["My photo upload failed", "How do I mark the ruler?"],
        "species": ["Which sites have these species?", "Check my record quality"],
        "sites": ["What species have I recorded?", "Show my habitat breakdown"],
        "habitats": ["What are my catch sites?", "How many fish have I recorded?"],
        "lengths": ["What is my most common species?", "How do I mark the ruler?"],
        "weights": ["What is my average fish length?", "Check my record quality"],
        "totals": ["What are my most common species?", "What is my latest catch?"],
        "recent": ["What species have I recorded?", "Check my record quality"],
        "data_quality": ["How do I review a species?", "How do I measure a fish?"],
        "model": ["What data do I need for training?", "How should I make a fish crop?"],
        "guidance": ["How do I mark the ruler?", "How should I make a fish crop?"],
        "protected_species": ["How should I document bycatch?", "How can I verify species status?"],
        "bycatch": ["Which bycatch fields should I record?", "How can catch data support conservation?"],
        "habitat_health": ["How should I monitor fish habitats in Pakistan?", "What can catch photos not tell me?"],
        "monitoring": ["How can catch data support conservation?", "How should I monitor fish along Pakistan’s coast?"],
    }
    defaults = ["Summarize my catches", "How can catch data support conservation?"]
    return activities.get(intent, activities["help"]), prompts.get(intent, [] if intent == "goodbye" else defaults)
