# Add QueryGPT to Open Source BI Tools

Hi there,

Found your list while researching BI tools (super helpful btw!) and wanted to add QueryGPT - we've been using it internally since May.

## Quick context

So we're a mid-size e-commerce company and our biggest pain point was the constant "hey can you pull this data for me" requests. Tried Metabase, tried Redash, but non-technical folks still struggled with the query builders.

QueryGPT solved this because people literally just type what they want. Like yesterday our marketing manager asked "compare conversion rates between email and social traffic this month vs last month" and boom - got the data + chart in under a minute. No tickets, no waiting.

## The tool

**QueryGPT** basically gives you a ChatGPT-like interface for your database. The clever bit is it uses OpenInterpreter, so it's not just generating SQL - it actually runs the queries and can do Python analysis when needed (like calculating statistical significance, which SQL can't really do).

Some real usage from our side:
- Sales team: "top 10 customers by revenue this quarter"
- Product: "user engagement metrics for feature X"
- Finance: "monthly recurring revenue breakdown by plan type"

Currently handling ~150 queries per day across 30+ users.

## Suggested addition

For the Self-Service BI section maybe:

```markdown
- **[QueryGPT](https://github.com/MKY508/QueryGPT)** - Natural language BI that actually works. Ask questions in plain English (or Chinese), get SQL + visualizations. Uses OpenInterpreter so it can handle complex analysis beyond just SQL. We use it daily - cut our ad-hoc query requests by 80%. `MIT` `self-hosted` `MySQL/PostgreSQL`
```

Let me know if you want more details or screenshots of it in action!

Cheers
