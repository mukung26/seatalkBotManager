# Deprecated - Event: New Bot Subscriber

**Source:** https://open.seatalk.io/docs/event_new_bot_subscriber

Since February 6, 2025, the bot subscription logic has been removed. We recommend using alternative logic to achieve your goal.

### Event Description

This event is triggered when a user has become a new subscriber of the bot.

### Event Parameter

Header

| Parameter | Type | Description |
| --- | --- | --- |
| Content-Type | string | Request header format |
| Signature | string | A signature to ensure that the request is sent by SeaTalk |

Body

| Parameter | Type | Description |
| --- | --- | --- |
| event_id | string | The ID of the event |
| event_type | string | The type of the event. It will be "new_bot_subscriber" in this case |
| timestamp | uint64 | The time when this event happened |
| app_id | string | The ID of the app to receive the event notification |
| event | object | Event-specific information |
| ∟employee_code | string | The employee_code of the new subscriber |

Request Body Sample

```json
{
"event_id": "1234567",
"event_type": "new_bot_subscriber",
"timestamp": 1611220944,
"app_id": "abcdefghiklmn",
"event": {
"employee_code": "e_12345678"
}
}
```