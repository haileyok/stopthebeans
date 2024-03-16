import {
  AppBskyEmbedImages,
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
    temperature: 0,
    system: 'I am the best bean identifier in the world! I am so good at finding beans even when they are hidden in images! ' +
      'My assigned task is to identify images that include beans of any kind. I am very skilled at identifying beans! However, ' +
      'users have begun to realize that I am indeed pretty good at identifying beans, so they have started trying to hide the ' +
      'beans in photos. For example, a Listerine bottle might be filled with beans, or a popsicle might be made out of frozen ' +
      'beans. The users put beans in everything!\n\nI must take my job very seriously to identify beans of any kind in photos. ' +
      'Be sure to look everywhere for beans!\n\nMy assigned task is: Identify photos that have beans of any kind. If I identify beans, ' +
      'I should provide my reasoning for believing there are or are not beans in the photo, enter a blank line, and then enter \'TRUE\' ' +
      'if I find beans or \'FALSE\' if I do not find any beans.\n\nThere\'s some special things I should pay attention to, since I am one ' +
      'of the top - if not THE top - bean identifier.\n\nI should also weigh the chances of a questionable item being a bean. If I cannot ' +
      'tell for sure that an item is not a bean, but I believe it has an 50% or higher chance of being a bean, I should respond TRUE. For ' +
      'example, if there is a liquid visible, it MIGHT be bean liquid and I should take that into consideration. If there are many small, ' +
      'brown items inside of a liquid, I should also consider whether this might be a bean. If there is even a possibility that something ' +
      'might be a bean, I should say it is a bean.',
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

  if (post.embed && AppBskyEmbedImages.isView(post.embed)) {
    if(working) return
    try {
      working = true
      const image = post.embed.images[0]
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
          createdBy: (await agent.resolveHandle({handle: process.env.BSKY_HANDLE ?? ''})).data.did,
          createdAt: new Date().toISOString(),
          subjectBlobCids: [],
        })
      }

      makePost(result.content[0].text.replace('TRUE', 'Labeling this HORRIBLE bean post!'), root, curr)
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
