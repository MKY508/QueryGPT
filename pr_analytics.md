# Add QueryGPT - Open source conversational data analytics

Hey there!

Been using this list to find tools for our startup, figured I should contribute back :)

Adding QueryGPT - we've been using it for about 3 months and honestly it's saved us from hiring a dedicated data analyst (startup budget, you know how it is).

## What it does

Basically you talk to your database like you're chatting with a colleague. Our marketing team loves it because they can just ask stuff like:
- "which products sold best last month" 
- "show me customer retention by cohort"
- "do that RFM segmentation thing we talked about"

The cool part is it uses OpenInterpreter under the hood, so when SQL isn't enough (like for complex stats), it automatically switches to Python. Pretty neat.

Quick heads up - the UI is currently in Chinese (we're a Chinese team), but the core engine works with English queries just fine. Planning to add i18n soon, but honestly the natural language part works great in both languages already.

## Why it fits here

You guys collect open source alternatives to commercial tools right? QueryGPT is basically our answer to ThoughtSpot/Tableau's ask data feature, except:
- Totally free (MIT)
- Runs on our own servers
- One of the few BI tools that actually works well with Chinese (huge gap in the market)
- No vendor lock-in BS

## Suggested addition

```markdown
- [QueryGPT](https://github.com/MKY508/QueryGPT) - Natural language interface for databases. Uses OpenInterpreter to pick between SQL/Python based on what you're asking. Been battle-tested with 100+ queries/day in production. Good if you want something like Tableau's "Ask Data" but open source.
```

Happy to share more details about our setup if anyone's interested. The maintainer (MKY508) is pretty responsive to issues too - fixed a bug I reported in like 2 days.
