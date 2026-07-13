# Update Message

**Source:** https://open.seatalk.io/docs/Update-Interactive-Message-Card

Requires SeaTalk App version 3.38.1 or later

## API Description

This API allows a bot to update an interactive message it previously sent to a user or group chat.

The rate limit for this endpoint is 100 requests/min and 20 requests/sec.

Note:

- All elements of the message card can be updated, and it must follow the card building rule

- The bot which updating the message must be the original sender

- The bot must be in the group chat to update a message in that group

- Messages can only be updated within 7 days of being sent

Request Method: `POST`

End Point: https://openapi.seatalk.io/messaging/v2/update (https://openapi.seatalk.io/messaging/v2/update) 

## Request Parameter

#### Header

| Parameter | Type | Mandatory | Description | Default | Sample |
| --- | --- | --- | --- | --- | --- |
| Authorization | string | Yes | Obtained through the Get App Access Token API | N/A | Bearer c8bda0f77ef940c5bea9f23b2d7fc0d8 |
| Content-Type | string | Yes | Request header format | N/A | application/json |

Body

| Parameter | Type | Mandatory | Description | Default | Length Limit |
| --- | --- | --- | --- | --- | --- |
| message_id | string | Yes | The message ID | N/A | N/A |
| message | object | Yes | The message to be updated | N/A | N/A |
| ∟interactive_message | object | Yes | The interactive message card object | N/A | N/A |
| ∟elements | object | Yes | The elements of the interactive message card. For card-building rules and card element descriptions, refer to Build a Card for details | N/A | N/A |

Request Sample

```json
{
"message_id": "uFrIUn3uDAIRQpReXQ0G6T8fxG0duqp67smFLmG5cwU",
"message": {
"interactive_message": {
"elements": [
{
"element_type": "title",
"title": {
"text": "Interactive Message Title"
}
},
{
"element_type": "description",
"description": {
"format": 1,
"text": "Interactive Message Description"
}
},
{
"element_type": "button",
"button": {
"button_type": "callback",
"text": "Callback Button",
"value": "test"
}
},
{
"element_type": "button",
"button": {
"button_type": "redirect",
"text": "rn link",
"mobile_link": {
"type": "rn",
"path": "/webview",
"params": {}
}
}
}
]
}
}
}
```

## Response Parameter

Result Field

| Parameter | Type | Mandatory | Description |
| --- | --- | --- | --- |
| code | int | Yes | Refer to Error Code for explanations |

#### Response Sample

```json
{
"code": 0
}
```