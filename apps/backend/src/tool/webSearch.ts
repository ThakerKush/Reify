import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import Exa from 'exa-js';
import config from '../config';

export const exa = new Exa(config.search.exa_api_key);
export const webSearch = tool({
    description: "Serach the web for up-to-date information", 
    inputSchema: z.object({
        query: z.string().describe("The search query"),
    }),
    execute: async ({ query }) => {
        const { results } = await exa.search( query, {
            type: "fast",
            numResults: 10
        })
        return results.map((result) => ({
            title: result.title,
            url: result.url,
            publishedDate: result.publishedDate,
        }))
    }
})

export const webExtract = tool({
    description: "Extract the information from the web search results",
    inputSchema: z.object({
        url: z.string().describe("The URL of the result"),
    }),
    execute: async ({ url }) => {
        const content = await exa.getContents(url);
        return content.results.map((result) => ({
            author: result.author,
            title: result.title,
            url: result.url,
            text: result.text
        }))
    }
})

