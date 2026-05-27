# Grunglebird Project Summary
This document summarizes the **purpose, use, and scope** of grunglebird.com.
This is not an architecture doc — it exists to give enough context that architecture and implementation decisions can be made well.

## One-line summary
A one-stop cocktail craft hub for "Mike" to use and share with friends.

## Purpose
Consolidate frequently used cocktail-crafting tools in one place, make them user friendly, and allow for easy sharing of recipes.

## Users and usage
Grunglebird will be used and maintained almost exclusively by one person (Mike).
Write access will be restricted, but anyone browsing the site should have read access to most everything.
Mike will likely access the site multiple times per day while it's being built and populated with recipes, but will taper off to a few times a week (at most) once stabilized.
Other people will likely only browse the site a few times a year.

## High-level features
* Cocktail ingredient inventory - maintains a database of ingredients used in cocktails, including price data.
* Cocktail recipes - hand-curated database of cocktail recipes. Has a builder for adding recipes and a searchable interface for finding and sharing them.
* Spirit finder - search interface that queries multiple ABC (Alcoholic Beverage Control) store inventories for specific items.
	- stretch: tie in with ingredient inventory to set alerts on availability or price change
* Events - used to share a menu preview for upcoming events, and let others pledge to fund the bar for necessary supplies
* Analytics - used to capture data on things like most frequently ordered drinks, trends over time, individual preferences, and other interesting data during or after an event.
