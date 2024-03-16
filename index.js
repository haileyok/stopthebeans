"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@atproto/api");
const dotenv = __importStar(require("dotenv"));
const atproto_firehose_1 = require("atproto-firehose");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const axios_1 = __importDefault(require("axios"));
dotenv.config();
const processedUris = new Set();
let working = false;
const agent = new api_1.BskyAgent({
    service: 'https://bsky.social/',
});
const anthropic = new sdk_1.default({
    apiKey: (_a = process.env.ANTHROPIC_API_KEY) !== null && _a !== void 0 ? _a : '',
});
const login = () => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    yield agent.login({
        identifier: (_b = process.env.BSKY_HANDLE) !== null && _b !== void 0 ? _b : '',
        password: (_c = process.env.BSKY_PASSWORD) !== null && _c !== void 0 ? _c : '',
    });
});
const makePost = (text, root, initialParent) => __awaiter(void 0, void 0, void 0, function* () {
    if (text.length <= 250) {
        return [text];
    }
    const words = text.split(' ');
    const parts = [];
    let currentLine = '';
    for (const word of words) {
        if ((currentLine + word).length <= 250) {
            currentLine += (currentLine === '' ? '' : ' ') + word;
        }
        else {
            parts.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine !== '') {
        parts.push(currentLine);
    }
    let nextParent = initialParent;
    for (const part of parts) {
        const res = yield agent.post({
            text: part,
            reply: {
                root,
                parent: nextParent
            },
        });
        nextParent = { uri: res.uri, cid: res.cid };
    }
});
const getImageBase64 = (uri) => __awaiter(void 0, void 0, void 0, function* () {
    // This should get the base64 of an image from a remote URI
    const res = yield axios_1.default.get(uri, { responseType: 'arraybuffer' });
    return Buffer.from(res.data, 'binary').toString('base64');
});
const checkImage = (base64) => __awaiter(void 0, void 0, void 0, function* () {
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
    });
});
const handleIncoming = (parentUri, root, curr) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    if (processedUris.has(parentUri))
        return;
    const post = (yield agent.getPosts({ uris: [parentUri] })).data.posts[0];
    console.log('try');
    if (post.embed && api_1.AppBskyEmbedImages.isView(post.embed)) {
        if (working)
            return;
        try {
            working = true;
            const image = post.embed.images[0];
            const base64 = yield getImageBase64(image.fullsize);
            const result = yield checkImage(base64);
            if (result.content[0].text.includes('TRUE')) {
                yield agent.withProxy('atproto_labeler', 'did:plc:3ehw5dwwptcy3xuzugwq2u6t').api.tools.ozone.moderation.emitEvent({
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
                    createdBy: (yield agent.resolveHandle({ handle: (_d = process.env.BSKY_HANDLE) !== null && _d !== void 0 ? _d : '' })).data.did,
                    createdAt: new Date().toISOString(),
                    subjectBlobCids: [],
                });
            }
            makePost(result.content[0].text.replace('TRUE', 'Labeling this HORRIBLE bean post!'), root, curr);
        }
        catch (e) {
            console.log(e);
        }
        finally {
            working = false;
        }
    }
    else {
        makePost('There is not a image here for me, the Best Identifier of Beans, to identify!', root, curr);
    }
    processedUris.add(parentUri);
});
const handleMessage = (message) => {
    var _a, _b;
    if (atproto_firehose_1.ComAtprotoSyncSubscribeRepos.isCommit(message)) {
        const repo = message.repo;
        const op = message.ops[0];
        if (api_1.AppBskyFeedPost.isRecord(op === null || op === void 0 ? void 0 : op.payload) &&
            op.payload.text.includes((_a = process.env.BSKY_HANDLE) !== null && _a !== void 0 ? _a : '') &&
            op.payload.reply) {
            const uri = `at://${repo}/${op.path}`;
            const cid = (_b = op.cid) === null || _b === void 0 ? void 0 : _b.toString();
            if (!cid)
                return;
            handleIncoming(op.payload.reply.parent.uri, op.payload.reply.root, { uri, cid });
        }
    }
};
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    yield login();
    const firehose = (0, atproto_firehose_1.subscribeRepos)('wss://bsky.network', {
        decodeRepoOps: true,
    });
    firehose.on('message', handleMessage);
});
run();
