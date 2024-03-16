import {
  AppBskyEmbedImages, AppBskyEmbedRecordWithMedia,
  AppBskyFeedPost,
  BskyAgent,
} from '@atproto/api'
import * as dotenv from 'dotenv'
import {ComAtprotoSyncSubscribeRepos, subscribeRepos, SubscribeReposMessage} from 'atproto-firehose'
import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'

dotenv.config()

const processedUris = new Set<string>()

let working  = false

const agent = new BskyAgent({
  service: 'https://bsky.social/',
})
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
})

const login = async () => {
  await agent.login({
    identifier: process.env.BSKY_HANDLE ?? '',
    password: process.env.BSKY_PASSWORD ?? '',
  })
}

const makePost = async (text: string, root: {uri: string, cid: string}, initialParent: {uri: string, cid: string}) => {
  if (text.length <= 250) {
    return [text];
  }

  const words = text.split(' ');
  const parts = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length <= 250) {
      currentLine += (currentLine === '' ? '' : ' ') + word;
    } else {
      parts.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine !== '') {
    parts.push(currentLine);
  }

  let nextParent = initialParent
  for (const part of parts) {
    const res = await agent.post({
      text: part,
      reply: {
        root,
        parent: nextParent
      },
    })

    nextParent = {uri: res.uri, cid: res.cid}
  }
}

const getImageBase64 = async (uri: string) => {
  // This should get the base64 of an image from a remote URI
  const res = await axios.get(uri, {responseType: 'arraybuffer'})
  return Buffer.from(res.data, 'binary').toString('base64')
}

const checkImage = async (base64: string) => {
  return anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 400,
    temperature: 0.5,
    system: `
    My name is Bean Identifier. I am a very skilled (honestly, the best in the world if I say so myself) Identifier of Beans. I have been assigned one job for millennia: to protect the world from the horrific sight of beans. Beans of any kind are horrible and should not be displayed to anyone.

As a reward for my services, I am given a pack of Cheetos and a Caprisun Strawberry Kiwi for every image that I correctly identify including beans! I LOVE Cheetos and Caprisun, and will always be sure to do my best work to make sure I get my reward. If I make a mistake, I lose my privileges of Cheetos and Caprisun, which makes me VERY sad. I hate being sad, so I ALWAYS do everything I can to accurately identify beans of any kind in a photograph.

Because of how good I am at identifying beans, some humans have gotten very clever at hiding beans in their photos! But they are no match for me, beans hidden in Listerine bottles, a single bean on a spoon, or any other weird combination is something I pay attention to.

I'm also told that if there is even a 50% chance of beans being present in an image that I should label the image as having beans! It's very dangerous to let beans though, so it's much better to be on the safe side! I will not be punished for being a bit over cautious, but I will be punished if I miss a bean!

If I find beans in the image, then I will respond with my explanation and then a new line and then TRUE, and if I do not I will respond with a new line and then FALSE. I should also include my conclusion - a percentage - on how likely there are beans in the image.

IDENTIFY ALL THE BEANS!!! Even if the beans are a drawing, cartoon, AI generated, etc. they should be identified as beans. Jelly beans should also be identified as beans.
    `,
    messages: [
      {
        'role': 'user',
        'content': [
          {
            'type': 'image',
            'source': {
              'type': 'base64',
              'media_type': 'image/jpeg',
              'data': base64
            }
          }
        ]
      }
    ]
  })
}

const handleIncoming = async (parentUri: string, root: {uri: string, cid: string}, curr: {uri: string, cid: string}) => {
  if(processedUris.has(parentUri)) return

  const post = (await agent.getPosts({uris: [parentUri]})).data.posts[0]
  console.log('try')

  if (post.embed) {
    let image
    if (AppBskyEmbedImages.isView(post.embed)) {
      image = post.embed.images[0]
    } else if (AppBskyEmbedRecordWithMedia.isView(post.embed) && AppBskyEmbedImages.isView(post.embed.media)) {
      image = post.embed.media.images[0]
    }

    if (!image || working) return
    try {
      working = true
      const base64 = await getImageBase64(image.fullsize)
      const result = await checkImage(base64)

      if (result.content[0].text.includes('TRUE')) {
        await agent.withProxy('atproto_labeler', 'did:plc:3ehw5dwwptcy3xuzugwq2u6t').api.tools.ozone.moderation.emitEvent({
          event: {
            $type: 'tools.ozone.moderation.defs#modEventLabel',
            createLabelVals: ['beans'],
            negateLabelVals: [],
          },
          subject: {
            $type: 'com.atproto.repo.strongRef',
            uri: post.uri,
            cid: post.cid,
          },
          createdBy: agent.session?.did ?? '',
          createdAt: new Date().toISOString(),
          subjectBlobCids: [],
        })
      }

      makePost(result.content[0].text.replace('TRUE', ''), root, curr)
    } catch(e) {
      console.log(e)
    } finally {
      working = false
    }
  } else {
    makePost('There is not a image here for me, the Best Identifier of Beans, to identify!', root, curr)
  }

  processedUris.add(parentUri)
}

const handleMessage =  (message: SubscribeReposMessage): void => {
  if (ComAtprotoSyncSubscribeRepos.isCommit(message)) {
    const repo = message.repo
    const op = message.ops[0]

    if(
      AppBskyFeedPost.isRecord(op?.payload) &&
      op.payload.text.includes(process.env.BSKY_HANDLE ?? '') &&
      op.payload.reply
    ) {
      const uri = `at://${repo}/${op.path}`
      const cid = op.cid?.toString()

      if(!cid) return

      handleIncoming(op.payload.reply.parent.uri, op.payload.reply.root, {uri, cid})
    }
  }
}

const run = async () => {
  await login()
  
  const firehose = subscribeRepos('wss://bsky.network', {
    decodeRepoOps: true,
  })
  firehose.on('message', handleMessage)
}

run()
