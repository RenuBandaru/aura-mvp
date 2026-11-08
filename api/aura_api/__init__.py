"""AURA API: the layer between the React app and the engine.

The API does three jobs the engine deliberately does not do:

1. **Holds the data.** :mod:`aura_api.store` keeps the use cases, AI tools and rules, starting from the
   sample data. Locally that is memory plus an optional JSON file; in Azure it becomes a database.
2. **Knows who is asking.** Every request names the person acting (a header today, the Microsoft
   sign-in later). See :func:`aura_api.routes.actor_id`.
3. **Shapes data for screens.** :mod:`aura_api.views` turns engine results into what a page needs, so
   React never re-implements a governance rule.

The same request handlers run in two hosts: ``dev_server.py`` (standard library only, for laptops)
and ``function_app.py`` (Azure Functions).
"""
