# Rule34 API Documentation

> Copied from the rule34.xxx API help page on **2026-07-10**. Check the official page for changes.

## API Basics

You should never receive an error unless the server is overloaded or the search dies. In cases of the searcher breaking, you will receive a response success of `false` and a message stating "search down" or similar.

## API Keys

URL to request an API key: <https://rule34.xxx/index.php?page=account&s=options>

| Parameter | Description |
|---|---|
| `user_id` | Enter the ID of your user |
| `api_key` | The API key |

API limits may be changed at any time. If you run an application that requires higher limits, you can request an unlimited key. This is only applicable for large public projects.

If it's a big site/app that's more urgent, make a ticket on their Discord or alternatively site-mail staff: <https://rule34.xxx/index.php?page=forum&s=view&id=4240>

They reserve the right to disable or deny any key.

## API Terms of Service

- When using the rule34.xxx API or if you serve content from their CDN, you will not display any advertisements or run paywalls. This applies to all bots, apps, and websites.
- Do not use or request more than one API key. Using multiple keys will result in a suspension of your key or account.

## Posts

### List

```
https://api.rule34.xxx/index.php?page=dapi&s=post&q=index
```

| Parameter | Description |
|---|---|
| `limit` | How many posts you want to retrieve. There is a hard limit of 1000 posts per request. |
| `pid` | The page number. |
| `tags` | The tags to search for. Any tag combination that works on the website will work here. This includes all the meta-tags. See the cheatsheet for more information. |
| `cid` | Change ID of the post. This is in Unix time, so there are likely others with the same value if updated at the same time. |
| `id` | The post id. |
| `json` | Set to `1` for a JSON formatted response. |
| `fields=tag_info` | Additional field to show tag types per post. |

### Deleted Images

```
https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&deleted=show
```

| Parameter | Description |
|---|---|
| `last_id` | A numerical value. Will return everything above this number. |

## Comments

### List

```
https://api.rule34.xxx/index.php?page=dapi&s=comment&q=index
```

| Parameter | Description |
|---|---|
| `post_id` | The id number of the post to retrieve comments for. |

## Tags

### List

```
https://api.rule34.xxx/index.php?page=dapi&s=tag&q=index
```

| Parameter | Description |
|---|---|
| `id` | The tag's id in the database. This is useful to grab a specific tag if you already know this value. |
| `limit` | How many tags you want to retrieve. There is a default limit of 100 per request. |

## Autocomplete

### List

```
https://api.rule34.xxx/autocomplete.php?q=
```

| Parameter | Description |
|---|---|
| `q` | Enter any letter or incomplete tag. Not an official endpoint, but some people seem to rip the one from the main site. Use this one instead. |
