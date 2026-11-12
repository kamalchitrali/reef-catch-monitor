"""Conservative, source-aware fisheries-conservation guidance.

This is intentionally a bounded knowledge layer, not a substitute for current
law, an IUCN assessment, or advice from the responsible fisheries authority.
"""


def conservation_topic(message: str) -> str | None:
    question = message.casefold()
    topics = [
        ("protected_species", ("protected", "endangered", "threatened", "red list", "release alive", "rare species")),
        ("bycatch", ("bycatch", "discard", "non-target", "turtle", "dolphin", "seabird")),
        ("habitat_health", ("habitat health", "fish habitat", "aquatic habitat", "coastal habitat", "mangrove", "estuary", "river health", "coral", "reef", "bleaching")),
        ("climate", ("climate", "warming", "temperature", "acidification")),
        ("pollution", ("pollution", "plastic", "oil spill", "wastewater", "litter")),
        ("mpa", ("marine protected", "protected area", " mpa", "no-take")),
        ("sustainable_fishing", ("sustainable", "overfish", "illegal fishing", "iuu", "destructive fishing", "size limit", "closed season")),
        ("monitoring", ("conservation", "biodiversity", "ecosystem", "management", "decline", "trend", "monitoring", "baseline", "protect fish", "save fish")),
    ]
    for topic, phrases in topics:
        if any(phrase in question for phrase in phrases):
            return topic
    return None


def _dataset_context(catches: list[dict]) -> str:
    fish = [item for catch in catches if not catch.get("demo") for item in catch.get("specimens", [])]
    research_catches = [catch for catch in catches if not catch.get("demo")]
    sites = {catch.get("site") for catch in research_catches if catch.get("site")}
    if not research_catches:
        return ("You do not need saved records to start planning conservation monitoring. When you collect data, keep demonstration "
                "records separate and use consistent sites, effort, dates, gear, and reviewed species labels.")
    return (f"Your current non-demo dataset contains {len(research_catches)} catch record(s), {len(fish)} specimen(s), and "
            f"{len(sites)} site(s). That is useful for checking data quality, but it is not automatically evidence of a population trend.")


def conservation_answer(topic: str, catches: list[dict]) -> str:
    context = _dataset_context(catches)
    answers = {
        "protected_species": (
            "Treat a potentially protected or threatened animal as a priority review: minimize handling, keep it in the water when safe, "
            "record time/location and non-invasive photographs, and follow the local authority’s release and reporting procedure. Do not "
            "infer legal status from this app alone—status and regulations change by species and jurisdiction. Verify the identification and "
            "check the current national fisheries list, the responsible authority, and the current IUCN assessment."
        ),
        "bycatch": (
            "A useful bycatch plan records every non-target capture, including animals released alive, gear, soak time, location, condition at "
            "release, and mitigation used. Compare rates per unit of fishing effort—not raw totals—then test practical changes such as gear "
            "modification, shorter soak times, spatial/seasonal avoidance, or safe-release training. Preserve zero-catch sampling events too."
        ),
        "habitat_health": (
            "Fish photographs can support habitat monitoring when paired with repeatable sites and effort. Along Pakistan’s coast and inland "
            "waters, track species composition, size distributions, habitat, and photo context across repeated surveys. Mangrove, estuary, "
            "river, reservoir, coral, and water-quality observations need their own standardized fields; catch photographs alone cannot measure habitat health."
        ),
        "climate": (
            "For climate-related monitoring, repeat observations at fixed sites and seasons and pair fish records with temperature and habitat "
            "data. Look for changes in occurrence, size structure, timing, and community composition, while accounting for gear, effort, and "
            "observer changes. A short or opportunistic series cannot separate climate effects from fishing pressure or sampling bias."
        ),
        "pollution": (
            "Record pollution observations separately from biological labels: type, extent, location, date, photographs, and whether wildlife "
            "was affected. Avoid handling hazardous material and report urgent spills or entanglement events through the responsible local "
            "authority. Fish-catch data may help identify co-occurrence, but it does not establish that pollution caused a biological change."
        ),
        "mpa": (
            "Evaluate a marine protected area with comparable inside/outside reference sites, repeated sampling, consistent effort, and a "
            "before/after design where possible. Useful outcomes include size distributions, biomass proxies, species occupancy, and bycatch "
            "rates. Record enforcement and fishing-effort changes because protection on paper alone does not establish ecological effect."
        ),
        "sustainable_fishing": (
            "Sustainable monitoring should record species, length, weight, gear, effort, location, season, and retained/released status. Use "
            "length distributions and catch per unit effort over repeated, comparable sampling—not isolated catch totals. Minimum sizes, closed "
            "seasons, quotas, and protected-species rules must come from the current local fisheries authority; this app should document, not "
            "invent, those rules."
        ),
        "monitoring": (
            "A defensible conservation program starts with a specific question, such as whether size structure or catch per unit effort changes "
            "at fixed sites. Define the sampling unit, record zero-catch events and effort, keep the same specimen/session in one data group, "
            "review uncertain species, and report missing or unusable photographs. Compare like with like and show uncertainty before making "
            "management claims."
        ),
    }
    return f"{answers[topic]}\n\nDataset note: {context}"


def conservation_welcome(catches: list[dict]) -> str:
    return ("I can help with fisheries-conservation questions even before you save a catch. Ask about sustainable monitoring in Pakistan’s "
            "coastal or Indus fisheries, bycatch, aquatic-habitat pressures, protected-species handling, or how catch photographs can support management. "
            "I will distinguish general guidance from conclusions supported by your records and will flag topics that require current local "
            f"regulations.\n\nDataset note: {_dataset_context(catches)}")
