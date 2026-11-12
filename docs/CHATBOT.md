# Reef Assistant

Reef Assistant is the in-app conversational layer for Reef Catch Monitor. It is designed to make saved catch records and the measurement workflow easier to explore without presenting an unverified general-purpose AI as a scientific authority.

## Conversation experience

- Greets the signed-in researcher by first name and responds naturally to greetings, thanks, confirmations, and goodbyes.
- Shows a short thinking state while the server reviews the request.
- Keeps limited conversation context so follow-up questions such as “tell me more” can continue the previous supported topic.
- Offers suggested questions for conservation monitoring and catch-data exploration.
- Is available from the floating **Ask Reef** button and from the **Model & assistant** page.

## Supported questions

Reef can summarize the signed-in account's:

- number of saved catches and specimens;
- reviewed species and labels still marked Unknown;
- collection sites and habitats;
- physical measurements and calibrated photo estimates;
- recorded weights and recent catches; and
- missing labels, lengths, habitats, or other data-quality gaps.

It can also explain the photo workflow, including image upload, ruler calibration, snout-to-tail markers, species crops, saving records, and preparing a grouped train/test manifest for the species baseline. Its bounded conservation guidance covers monitoring design for Pakistan's coastal and Indus fisheries, aquatic-habitat health, protected-species handling, bycatch, pollution, climate pressures, marine protected areas, and sustainable fishing.

## Privacy and evidence boundaries

The chatbot is deterministic and runs inside the FastAPI application. It does not call an external language model and does not transmit catch records or conversation text to a third-party AI service. The backend loads only catches owned by the authenticated user before calculating an answer.

Responses distinguish between calculations from saved records and general guidance. Reef cannot identify a species from conversation alone, verify current local law, replace protected-species handling protocols, or establish model accuracy without representative held-out data. Users should verify local regulations and scientific conclusions with the relevant authority or qualified reviewer.

## Technical flow

1. The React client sends the message and recent supported conversation context to the authenticated chat endpoint.
2. The backend normalizes the text and selects a bounded intent such as `species`, `lengths`, `data_quality`, `guidance`, or a conservation topic.
3. For record questions, the server calculates aggregates from the user's private catches. For workflow or conservation questions, it selects reviewed guidance.
4. The API returns the answer, its intent, and any supporting evidence metadata for display.

The rules live in `backend/chat.py` and conservation guidance lives in `backend/conservation.py`. Extend the assistant by adding a narrowly scoped intent, tests for representative phrasing, and an answer that clearly identifies its evidence source and limitations.
